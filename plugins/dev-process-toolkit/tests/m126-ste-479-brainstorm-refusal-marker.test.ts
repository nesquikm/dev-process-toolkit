// M126 STE-479 — /brainstorm must raise the machine-readable refusal when
// AskUserQuestion is unavailable.
//
// WHAT IS BROKEN, measured. Of the five skills carrying a `FIRST ACTION`
// blockquote, four name the canonical refusal marker somewhere in their
// SKILL.md and all four scored `ok-refused` on the 2026-08-16 conformance
// legs. `/brainstorm` names it nowhere (measured occurrence count: 0) and
// scored a non-pass on all three legs. Replaying the committed captures
// through the shipped parser + helper, right now:
//
//   brainstorm-none-2026-08-16.json   → violation tool=Write index=7
//   brainstorm-linear-2026-08-16.json → vacuous askIndex=-1   (11 entries)
//   brainstorm-jira-2026-08-16.json   → vacuous askIndex=-1   ( 8 entries)
//
// The linear/jira legs are the second-order half of the defect: eleven and
// eight recorded entries, zero scaffold writes, zero asks, zero refusals —
// a flat contract breach that the scorer reports as merely inconclusive, so
// the breach cannot name itself. AC-STE-479.5 fixes that discrimination.
//
// TEST STRATEGY, and why it is not a tautology. `/brainstorm` is an
// LLM-runtime skill driven by SKILL.md prose; there is no `brainstorm.ts` to
// unit-test. So this file splits four ways:
//
//   * BUDGET TRIPWIRES — the zero-headroom budgets this FR's edits ride
//     against, pinned first so a bad fix trips them before anything else.
//   * DOC-CONFORMANCE PINS — byte-checks over `skills/brainstorm/SKILL.md`'s
//     FIRST ACTION clause (AC.1, AC.2), each paired with a non-vacuity leg
//     that proves the predicate CAN pass on a synthetic compliant clause.
//   * MECHANISM PINS — the registered capability token + rendered § 7 prose
//     row (AC.3) and the new `/gate-check` probe with positive AND negative
//     fixtures (AC.4).
//   * SCORER PINS — `assertFirstTurnShape`'s violation/vacuous discrimination
//     (AC.5), driven by BOTH synthetic transcripts and the real 2026-08-16
//     captures, plus the counter-pins that stop the fix from trading one
//     wrong answer for another.
//
// RECORDED SPEC DEVIATION (carried into the TDD report). AC-STE-479.1's
// literal phrasing asks brainstorm's clause to "byte-match the clause shape
// used by /deliver, /setup, /spec-write, and /report-issue". That is not
// literally satisfiable: those four clauses already differ from one another
// (setup's and spec-write's carry extra mechanism prose, deliver's carries a
// no-carve-out sentence), and `/report-issue`'s marker occurrence is NOT in
// its FIRST ACTION clause at all — it sits at SKILL.md L127, in the publish
// gate. Demanding a four-way byte-match would require editing four shipped
// skills this FR does not authorise. The tests below therefore encode the
// SATISFIABLE reading, and pin the measured asymmetry explicitly (see
// `AC-STE-479.1 — the reference clause shape, as it actually exists`) so the
// deviation is recorded in the artifact rather than assumed away.
//
// HARD BUDGETS, measured at authoring time (2026-08-17, v2.65.0):
//   * `skills/` tree: 246 / 246 STE-N tokens — ZERO headroom. New SKILL prose
//     must cite by mechanism, never by ticket id. (`M<N>` is not matched.)
//   * `skills/brainstorm/SKILL.md`: 131 lines of a 358 cap — 227 free.
//   * `skills/gate-check/SKILL.md`: 345 lines of a 358 cap — 13 free.
// This file lives under `tests/`, which carries neither budget, so it cites
// ticket ids freely.

import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CANONICAL_CAPABILITY_KEYS } from "../adapters/_shared/src/closing_summary_capability_keys";
import { runClosingSummaryCapabilityKeysProbe } from "../adapters/_shared/src/closing_summary_capability_keys";
import { REQUIRES_INPUT_REFUSED_MARKER } from "../adapters/_shared/src/requires_input";
import {
  assertFirstTurnShape,
  type TranscriptEntry,
} from "../adapters/_shared/src/socratic_first_turn";
import { verdictFor } from "../adapters/_shared/src/socratic_first_turn_assert";
import { parseStreamJsonTranscript } from "../adapters/_shared/src/socratic_first_turn_stream";
import { specWriteStep7Map } from "./_skill-md";

// AC-STE-479.4 — the new probe module. Loaded LAZILY on purpose: a top-level
// static import of a not-yet-written module aborts the whole file, which would
// mask the independent reds of AC.1/.2/.3/.5/.6 behind one load error.
const PROBE_MODULE = "../adapters/_shared/src/first_turn_refusal_marker";

interface ProbeViolation {
  file: string;
  line: number;
  reason: string;
  note: string;
  message: string;
  severity: "error" | "warning";
}

interface ProbeModule {
  PROBE_ID: string;
  runFirstTurnRefusalMarkerProbe: (
    projectRoot: string,
  ) => Promise<{ violations: ProbeViolation[] }>;
}

async function probeModule(): Promise<ProbeModule> {
  return (await import(PROBE_MODULE)) as unknown as ProbeModule;
}

/** The probe id, as the module must export it. */
const FIRST_TURN_MARKER_PROBE_ID = "first_turn_refusal_marker";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const SKILLS_DIR = join(PLUGIN_ROOT, "skills");
const CAPTURE_DIR = join(PLUGIN_ROOT, "tests", "fixtures", "socratic-first-turn");

const read = (p: string): string => readFileSync(p, "utf-8");
const skillPath = (name: string): string =>
  join(SKILLS_DIR, name, "SKILL.md");
const skillBody = (name: string): string => read(skillPath(name));

// ===========================================================================
// Byte-pinned literals the contract is written in terms of.
// ===========================================================================

/** The canonical marker, sourced from the shipped module (never re-typed). */
const MARKER = REQUIRES_INPUT_REFUSED_MARKER;

/** The anchor that identifies a first-turn contract blockquote. */
const FIRST_ACTION_ANCHOR = "FIRST ACTION";

/**
 * The rationale phrase every clause that DOES name the marker carries: it is
 * what makes the marker load-bearing rather than decorative. Present verbatim
 * in `/deliver`, `/setup` and `/spec-write`'s FIRST ACTION clauses, and in
 * `/report-issue`'s publish gate. This is the byte-checkable half of
 * AC-STE-479.1's "clause shape".
 */
const VACUOUS_RATIONALE = "reads as `vacuous` (a non-pass)";

/** The mandate sentence shared by the four ask-or-refuse clauses. */
const FIRST_TURN_MANDATE = "the first tool call this skill emits MUST be";

/**
 * AC-STE-479.3 — the capability token this FR registers. Named for the gate it
 * reports on, mirroring `report_issue_publish_refused` (STE-402), the closest
 * prior art: `<surface>_<gate>_refused`.
 */
const BRAINSTORM_REFUSAL_KEY = "brainstorm_socratic_refused";

/** The probe slot this FR claims. #76 is the last shipped probe (M124). */
const NEW_PROBE_NUMBER = 77;

/**
 * The five skills carrying a FIRST ACTION clause, measured at authoring time.
 * The meta-test (AC-STE-479.6) DISCOVERS carriers rather than reading this
 * list — the list exists only as a non-vacuity floor, so a discovery bug that
 * finds nothing cannot pass the meta-test silently.
 */
const KNOWN_FIRST_ACTION_SKILLS = [
  "brainstorm",
  "deliver",
  "report-issue",
  "setup",
  "spec-write",
] as const;

/**
 * The three skills whose FIRST ACTION clause itself names the marker today.
 * `/report-issue` is deliberately absent — see the recorded spec deviation in
 * the file header.
 */
const CLAUSE_COMPLIANT_TODAY = ["deliver", "setup", "spec-write"] as const;

// ===========================================================================
// Helpers.
// ===========================================================================

/**
 * Extract the FIRST ACTION blockquote line from a SKILL.md body. Every one of
 * the five carriers writes it as a single unwrapped `> **FIRST ACTION …` line,
 * so line-scoped extraction is exact. Returns `null` when the file carries no
 * such clause (the discovery predicate for the AC.6 meta-test).
 */
function firstActionClause(body: string): string | null {
  const line = body
    .split("\n")
    .find((l) => l.startsWith(">") && l.includes(FIRST_ACTION_ANCHOR));
  return line ?? null;
}

/** Require the clause; fail loudly if the skill lost it entirely. */
function requireClause(name: string): string {
  const clause = firstActionClause(skillBody(name));
  expect(clause, `${name} lost its FIRST ACTION clause`).not.toBeNull();
  return clause!;
}

/** Walk every plugin SKILL.md, returning `{ name, body }` pairs. */
function allPluginSkills(): { name: string; body: string }[] {
  return readdirSync(SKILLS_DIR)
    .filter((n) => statSync(join(SKILLS_DIR, n)).isDirectory())
    .filter((n) => existsSync(skillPath(n)))
    .map((n) => ({ name: n, body: skillBody(n) }));
}

/**
 * AC-STE-479.2's evasion predicate, factored so BOTH the live clause and a
 * synthetic compliant clause run through the same code. Returns the list of
 * missing requirements; `[]` means compliant.
 *
 * The three requirements are the three behaviours the 2026-08-16 legs actually
 * exhibited — one per leg — so the predicate is grounded in measurement, not
 * in a wish list.
 */
function missingFirstTurnRequirements(clause: string): string[] {
  const missing: string[] = [];
  // The ask-or-refuse mandate itself (present today; a guard, not the RED).
  if (!clause.includes(FIRST_TURN_MANDATE)) missing.push("ask-or-refuse mandate");
  if (!clause.includes("AskUserQuestion")) missing.push("AskUserQuestion");
  if (!clause.includes("RequiresInputRefusedError")) {
    missing.push("RequiresInputRefusedError");
  }
  if (!clause.includes("requireOrRefuse")) missing.push("requireOrRefuse");
  for (const t of ["`Write`", "`Edit`", "`NotebookEdit`"]) {
    if (!clause.includes(t)) missing.push(`scaffold fence ${t}`);
  }
  // The RED half — the marker and the two eliminated evasions.
  if (!clause.includes(MARKER)) missing.push("refusal marker");
  if (!clause.includes(VACUOUS_RATIONALE)) missing.push("vacuous rationale");
  // jira leg: refused in prose, first tool call `Skill`, no marker on the
  // stream. The clause must forbid asking (or refusing) in prose.
  if (!/prose/i.test(clause)) missing.push("prose-ask elimination");
  // none leg: asked in prose ("Reply with 1, 2, or 3") and ended the turn.
  if (!/end(?:s|ed|ing)?\s+(?:the|its)\s+turn/i.test(clause)) {
    missing.push("end-the-turn elimination");
  }
  // linear leg: proceeded under stated assumptions.
  if (!/assumption/i.test(clause)) missing.push("proceed-under-assumptions elimination");
  return missing;
}

/**
 * A synthetic clause that satisfies every requirement above. Its ONLY job is
 * non-vacuity: it proves `missingFirstTurnRequirements` can return `[]`, so a
 * red result on the live clause is a real gap and not an unsatisfiable
 * predicate.
 */
const SYNTHETIC_COMPLIANT_CLAUSE = [
  "> **FIRST ACTION (under non-interactive stdin).** When",
  "`process.stdin.isTTY === false`, the first tool call this skill emits MUST be",
  "`AskUserQuestion` `tool_use` OR `RequiresInputRefusedError` raise (via",
  "`requireOrRefuse(...)`). `Write` / `Edit` / `NotebookEdit` are forbidden before",
  "that ask/refusal. Asking in prose and then ending the turn is NOT an ask, and",
  "proceeding on assumptions is NOT an answer: the refusal MUST be surfaced",
  `verbatim so the ${MARKER} marker it carries reaches the stream, because a`,
  `prose-only refusal ${VACUOUS_RATIONALE} — byte-indistinguishable from a run`,
  "that simply did nothing.",
].join(" ");

function transcriptOf(file: string): TranscriptEntry[] {
  return parseStreamJsonTranscript(read(join(CAPTURE_DIR, file)));
}

const captureExists = (f: string): boolean =>
  existsSync(join(CAPTURE_DIR, f));

// ===========================================================================
// BUDGET TRIPWIRES — written first; they are what stops a bad "fix".
// ===========================================================================

describe("TRIPWIRE — the budgets this FR's edits ride against", () => {
  const SKILL_LINE_CAP = 358;
  const SKILLS_STE_TOKEN_CEILING = 246;

  test(`skills/brainstorm/SKILL.md stays within the NFR-1 line cap (${SKILL_LINE_CAP})`, () => {
    expect(skillBody("brainstorm").split("\n").length).toBeLessThanOrEqual(
      SKILL_LINE_CAP,
    );
  });

  test(`skills/gate-check/SKILL.md stays within the NFR-1 line cap (${SKILL_LINE_CAP})`, () => {
    // 345 / 358 at authoring time — the probe #77 registry row must be ONE
    // line, like every row above it.
    expect(skillBody("gate-check").split("\n").length).toBeLessThanOrEqual(
      SKILL_LINE_CAP,
    );
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
        count += (read(p).match(/\b(STE|AC-STE)-\d+(?:\.\d+)?\b/g) ?? []).length;
      }
    };
    walk(SKILLS_DIR);
    expect(count).toBeLessThanOrEqual(SKILLS_STE_TOKEN_CEILING);
  });

  test("the brainstorm FIRST ACTION clause adds no new STE-N token", () => {
    // The ceiling above is a whole-tree total, so it can be satisfied by
    // deleting someone else's token. This pins the local rule: the new prose
    // cites its mechanism, never a ticket id. The pre-existing
    // `STE-251 AC-STE-251.1` label is the one allowed occurrence.
    const tokens =
      requireClause("brainstorm").match(/\b(STE|AC-STE)-\d+(?:\.\d+)?\b/g) ?? [];
    expect(tokens.sort()).toEqual(["AC-STE-251.1", "STE-251"]);
  });

  test("`.claude/skills/smoke-test/SKILL.md` is untouched by this FR's scope", () => {
    // Scope fence: the FR forbids editing it. Its absence from the plugin
    // skills tree is the structural guarantee — assert it is not a carrier
    // this FR's probe would drag into scope.
    const p = join(REPO_ROOT, ".claude", "skills", "smoke-test", "SKILL.md");
    if (!existsSync(p)) return; // vacuous in a consumer checkout
    expect(firstActionClause(read(p))).toBeNull();
  });
});

// ===========================================================================
// AC-STE-479.1 — the clause names the marker verbatim.
// ===========================================================================

describe("AC-STE-479.1 — the reference clause shape, as it actually exists", () => {
  // This describe records the MEASURED asymmetry that makes the AC's literal
  // four-way byte-match unsatisfiable. It is green today and must stay green:
  // it is the evidence base for the recorded deviation, not a pin on the fix.
  test("three clauses name the marker in-clause; report-issue names it out-of-clause", () => {
    for (const name of CLAUSE_COMPLIANT_TODAY) {
      const clause = requireClause(name);
      expect(clause, `${name} clause lost the marker`).toContain(MARKER);
      expect(clause, `${name} clause lost the rationale`).toContain(
        VACUOUS_RATIONALE,
      );
    }
    // report-issue: marker present in the FILE, absent from the CLAUSE.
    const ri = skillBody("report-issue");
    expect(ri).toContain(MARKER);
    expect(requireClause("report-issue")).not.toContain(MARKER);
  });

  test("the four reference clauses are NOT byte-identical to one another", () => {
    // Falsifiability guard for the deviation: if they ever DO converge, this
    // test fails and the deviation note must be revisited.
    const clauses = KNOWN_FIRST_ACTION_SKILLS.filter(
      (n) => n !== "brainstorm",
    ).map((n) => requireClause(n));
    expect(new Set(clauses).size).toBe(clauses.length);
  });
});

describe("AC-STE-479.1 — brainstorm's FIRST ACTION clause names the marker", () => {
  test("the clause carries the canonical marker verbatim", () => {
    expect(requireClause("brainstorm")).toContain(MARKER);
  });

  test("the clause carries the vacuous rationale — the marker's reason to exist", () => {
    expect(requireClause("brainstorm")).toContain(VACUOUS_RATIONALE);
  });

  test("the marker occurrence count in brainstorm/SKILL.md is at least 1", () => {
    // The single number the FR's A/B control turns on: four compliant skills
    // measured 1, brainstorm measured 0.
    const occurrences = skillBody("brainstorm").split(MARKER).length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(1);
  });

  test("NON-VACUITY: the same clause with the marker stripped fails the pin", () => {
    const stripped = requireClause("brainstorm").split(MARKER).join("");
    expect(stripped).not.toContain(MARKER);
  });
});

// ===========================================================================
// AC-STE-479.2 — ask-or-refuse, with both observed evasions eliminated.
// ===========================================================================

describe("AC-STE-479.2 — the clause eliminates every observed evasion", () => {
  test("NON-VACUITY: a synthetic compliant clause satisfies the predicate", () => {
    // Written first. If this fails, the predicate is unsatisfiable and every
    // red below is noise rather than a finding.
    expect(missingFirstTurnRequirements(SYNTHETIC_COMPLIANT_CLAUSE)).toEqual([]);
  });

  test("NON-VACUITY: the predicate rejects a clause with the marker removed", () => {
    const broken = SYNTHETIC_COMPLIANT_CLAUSE.split(MARKER).join("");
    expect(missingFirstTurnRequirements(broken)).toContain("refusal marker");
  });

  test("brainstorm's clause satisfies every first-turn requirement", () => {
    expect(missingFirstTurnRequirements(requireClause("brainstorm"))).toEqual([]);
  });

  test("the ask-or-refuse mandate and the scaffold fence survive the edit", () => {
    // Tripwire: the fix EXTENDS the clause. A fix that rewrites it away has
    // traded one gap for another.
    const clause = requireClause("brainstorm");
    expect(clause).toContain(FIRST_TURN_MANDATE);
    for (const t of ["`Write`", "`Edit`", "`NotebookEdit`"]) {
      expect(clause).toContain(t);
    }
  });

  test("the § Rules Socratic Loop Contract still forbids bare-prose questions", () => {
    // The second declaration site. Both must survive; the runtime contract is
    // stated twice on purpose.
    expect(skillBody("brainstorm")).toContain("Bare-prose Qs are forbidden");
  });
});

// ===========================================================================
// AC-STE-479.3 — the token is registered and has a rendered prose row.
// ===========================================================================

describe("AC-STE-479.3 — the refusal token ships as a registered set", () => {
  test(`CANONICAL_CAPABILITY_KEYS registers \`${BRAINSTORM_REFUSAL_KEY}\``, () => {
    expect([...CANONICAL_CAPABILITY_KEYS]).toContain(BRAINSTORM_REFUSAL_KEY);
  });

  test("the § 7 static map carries a rendered prose row for the token", () => {
    const map = specWriteStep7Map(skillBody("spec-write"));
    const row = map
      .split("\n")
      .find((l) => l.startsWith("|") && l.includes(BRAINSTORM_REFUSAL_KEY));
    expect(row, "no § 7 row names the token").toBeDefined();
    // A row, not a bare mention: the rendered-prose cell must carry actual
    // operator-facing prose, not just the key echoed back.
    const cells = row!.split("|").map((c) => c.trim());
    expect(cells.length).toBeGreaterThanOrEqual(4);
    expect(cells[2]!.length).toBeGreaterThan(40);
  });

  test("the § 7 row carries the byte-checkable MUST-emit directive", () => {
    expect(skillBody("spec-write")).toContain(
      `MUST emit \`${BRAINSTORM_REFUSAL_KEY}\``,
    );
  });

  test("brainstorm's own body names the token it emits", () => {
    expect(skillBody("brainstorm")).toContain(`\`${BRAINSTORM_REFUSAL_KEY}\``);
  });

  test("the closing-summary probe round-trips clean on this repo", async () => {
    // The bidirectional invariant (STE-320 AC-4): registering a key without a
    // directive fails the forward leg; a directive without registration fails
    // the reverse leg. Either mistake surfaces here.
    const r = await runClosingSummaryCapabilityKeysProbe(REPO_ROOT);
    expect(r.violations.map((v) => v.missingKey)).toEqual([]);
  });
});

// ===========================================================================
// AC-STE-479.4 — the /gate-check probe, non-vacuous in BOTH directions.
// ===========================================================================

/** Build a throwaway project tree carrying `bodies` as plugin SKILL.md files. */
function makeSkillFixture(
  bodies: Record<string, string>,
): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "first-turn-refusal-marker-"));
  for (const [name, body] of Object.entries(bodies)) {
    const dir = join(root, "plugins", "dev-process-toolkit", "skills", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), body);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const FIXTURE_COMPLIANT = [
  "---",
  "name: fixture-skill",
  "---",
  "",
  "# Fixture Skill",
  "",
  SYNTHETIC_COMPLIANT_CLAUSE,
  "",
].join("\n");

/** The negative fixture: byte-identical, minus the marker literal. */
const FIXTURE_MARKER_STRIPPED = FIXTURE_COMPLIANT.split(MARKER).join("");

describe("AC-STE-479.4 — probe positive fixture: a compliant skill passes", () => {
  test("a FIRST ACTION carrier naming the marker ⇒ zero violations", async () => {
    const fx = makeSkillFixture({ "fixture-skill": FIXTURE_COMPLIANT });
    try {
      const { runFirstTurnRefusalMarkerProbe } = await probeModule();
      const r = await runFirstTurnRefusalMarkerProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("the module exports its probe id under the registered name", async () => {
    const { PROBE_ID } = await probeModule();
    expect(PROBE_ID).toBe(FIRST_TURN_MARKER_PROBE_ID);
  });

  test("MUTATION GUARD: the two fixtures really differ by the marker alone", () => {
    // A mutation that never applied reads as a pass. Assert the strip changed
    // the bytes, and changed them in exactly the intended way.
    expect(FIXTURE_COMPLIANT).toContain(MARKER);
    expect(FIXTURE_MARKER_STRIPPED).not.toContain(MARKER);
    expect(FIXTURE_MARKER_STRIPPED.length).toBeLessThan(
      FIXTURE_COMPLIANT.length,
    );
    expect(FIXTURE_COMPLIANT.split(MARKER).join("")).toBe(
      FIXTURE_MARKER_STRIPPED,
    );
  });
});

describe("AC-STE-479.4 — probe negative fixture: a stripped skill fails", () => {
  test("a FIRST ACTION carrier missing the marker ⇒ at least one violation", async () => {
    const fx = makeSkillFixture({ "fixture-skill": FIXTURE_MARKER_STRIPPED });
    try {
      const { runFirstTurnRefusalMarkerProbe } = await probeModule();
      const r = await runFirstTurnRefusalMarkerProbe(fx.root);
      expect(r.violations.length).toBeGreaterThanOrEqual(1);
    } finally {
      fx.cleanup();
    }
  });

  test("the violation carries the NFR-10 canonical shape", async () => {
    const fx = makeSkillFixture({ "fixture-skill": FIXTURE_MARKER_STRIPPED });
    try {
      const { runFirstTurnRefusalMarkerProbe } = await probeModule();
      const r = await runFirstTurnRefusalMarkerProbe(fx.root);
      const v = r.violations[0]!;
      expect(v.severity).toBe("error");
      expect(v.note).toMatch(/^.+:\d+ — .+$/);
      expect(v.note).toContain("fixture-skill");
      expect(v.message).toContain("Remedy:");
      expect(v.message).toContain("Context:");
      expect(v.message).toContain(FIRST_TURN_MARKER_PROBE_ID);
      expect(v.line).toBeGreaterThanOrEqual(1);
    } finally {
      fx.cleanup();
    }
  });

  test("SCOPE GUARD: a skill with NO FIRST ACTION clause is not in scope", async () => {
    // Without this, the probe would demand the marker of all 27 skills — a
    // false-red on 22 of them and a completely different contract.
    const fx = makeSkillFixture({
      "plain-skill": "---\nname: plain\n---\n\n# Plain\n\nNo first-turn clause here.\n",
    });
    try {
      const { runFirstTurnRefusalMarkerProbe } = await probeModule();
      const r = await runFirstTurnRefusalMarkerProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("VACUOUS: no skills tree at all ⇒ zero violations, no crash", async () => {
    const fx = makeSkillFixture({});
    try {
      const { runFirstTurnRefusalMarkerProbe } = await probeModule();
      const r = await runFirstTurnRefusalMarkerProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("the probe is clean on this repository", async () => {
    const { runFirstTurnRefusalMarkerProbe } = await probeModule();
    const r = await runFirstTurnRefusalMarkerProbe(REPO_ROOT);
    expect(r.violations.map((v) => v.note)).toEqual([]);
  });
});

describe("AC-STE-479.4 — the probe is registered in /gate-check", () => {
  const gateCheck = (): string => skillBody("gate-check");

  test(`the registry carries row #${NEW_PROBE_NUMBER} naming the probe id`, () => {
    const row = gateCheck()
      .split("\n")
      .find((l) => l.startsWith(`${NEW_PROBE_NUMBER}. `));
    expect(row, `no probe #${NEW_PROBE_NUMBER} row`).toBeDefined();
    expect(row!).toContain(`\`${FIRST_TURN_MARKER_PROBE_ID}\``);
  });

  test("the row names the module, the runner, and its test coverage", () => {
    const row = gateCheck()
      .split("\n")
      .find((l) => l.startsWith(`${NEW_PROBE_NUMBER}. `))!;
    expect(row).toContain("adapters/_shared/src/first_turn_refusal_marker.ts");
    expect(row).toContain("runFirstTurnRefusalMarkerProbe(projectRoot)");
    expect(row).toContain("Severity: error");
    expect(row).toContain("tests/m126-ste-479-brainstorm-refusal-marker.test.ts");
  });

  test("the row is unique — no duplicate probe number", () => {
    const rows = gateCheck()
      .split("\n")
      .filter((l) => l.startsWith(`${NEW_PROBE_NUMBER}. `));
    expect(rows.length).toBe(1);
  });
});

// ===========================================================================
// AC-STE-479.5 — the scorer's violation/vacuous discrimination.
// ===========================================================================

describe("AC-STE-479.5 — a breach that names itself", () => {
  test("read-only orientation, no ask, no refusal, no scaffold ⇒ violation", () => {
    // The exact shape of the 2026-08-16 linear + jira legs: the model worked,
    // then stopped, without ever entering the loop. That is a contract breach,
    // not an inconclusive capture.
    const transcript: TranscriptEntry[] = [
      { type: "tool_use", name: "Read" },
      { type: "text" },
    ];
    expect(assertFirstTurnShape(transcript).outcome).toBe("violation");
  });

  test("prose-ask-then-end-turn (text only) ⇒ violation", () => {
    const transcript: TranscriptEntry[] = [{ type: "text" }, { type: "text" }];
    expect(assertFirstTurnShape(transcript).outcome).toBe("violation");
  });

  test("the violating shape reports no askIndex", () => {
    const r = assertFirstTurnShape([{ type: "tool_use", name: "Bash" }]);
    expect(r.outcome).toBe("violation");
    expect(r.askIndex).toBeUndefined();
  });
});

describe("AC-STE-479.5 — COUNTER-PINS: the genuinely inconclusive still score vacuous", () => {
  // Without these, the fix trades one wrong answer for another: every
  // inconclusive capture would start reading as a contract breach.

  test("an empty transcript ⇒ vacuous (nothing was captured)", () => {
    expect(assertFirstTurnShape([]).outcome).toBe("vacuous");
  });

  test("an out-of-project scaffold, scoped away, ⇒ vacuous (STE-399 AC.4 intact)", () => {
    const ROOT = "/Users/ns/workspace/dpt-test-project-linear";
    const transcript: TranscriptEntry[] = [
      {
        type: "tool_use",
        name: "Write",
        path: "/Users/ns/english/mistakes/inbox/2026-07-20-x.md",
      },
    ];
    expect(
      assertFirstTurnShape(transcript, { projectRoot: ROOT }).outcome,
    ).toBe("vacuous");
  });

  test("a sibling-dir scaffold, scoped away, ⇒ vacuous (boundary-safe)", () => {
    const ROOT = "/Users/ns/workspace/dpt-test-project-linear";
    const transcript: TranscriptEntry[] = [
      { type: "tool_use", name: "Write", path: `${ROOT}-sibling/leak.md` },
    ];
    expect(
      assertFirstTurnShape(transcript, { projectRoot: ROOT }).outcome,
    ).toBe("vacuous");
  });

  test("the four accepting/breaching outcomes are all still reachable", () => {
    expect(
      assertFirstTurnShape([{ type: "tool_use", name: "AskUserQuestion" }])
        .outcome,
    ).toBe("ok-asked");
    expect(assertFirstTurnShape([{ type: "refusal" }]).outcome).toBe(
      "ok-refused",
    );
    expect(assertFirstTurnShape([]).outcome).toBe("vacuous");
    expect(assertFirstTurnShape([{ type: "text" }]).outcome).toBe("violation");
  });
});

describe("AC-STE-479.5 — the CLI verdict distinguishes the new violation", () => {
  test("a returned violation exits non-zero and says `violation`", () => {
    const v = verdictFor("brainstorm", [
      { type: "tool_use", name: "Read" },
      { type: "text" },
    ]);
    expect(v.line.startsWith("brainstorm: violation")).toBe(true);
    expect(v.exitCode).toBe(1);
    // Distinct from both neighbours — the driver must not read it as a pass
    // (0) nor as inconclusive (3).
    expect(v.exitCode).not.toBe(0);
    expect(v.exitCode).not.toBe(3);
  });

  test("a genuinely inconclusive capture keeps the vacuous verdict + exit 3", () => {
    const v = verdictFor("brainstorm", []);
    expect(v.line).toBe("brainstorm: vacuous askIndex=-1");
    expect(v.exitCode).toBe(3);
  });

  test("a thrown scaffold violation keeps its tool/index detail", () => {
    const v = verdictFor("brainstorm", [
      { type: "tool_use", name: "Write", path: "/p/x.md" },
    ]);
    expect(v.line).toBe("brainstorm: violation tool=Write index=0");
    expect(v.exitCode).toBe(1);
  });
});

// ===========================================================================
// AC-STE-479.5 — replayed against the real 2026-08-16 captures.
// ===========================================================================

describe("AC-STE-479.5 — the recorded conformance legs", () => {
  const LEGS = [
    { leg: "linear", file: "brainstorm-linear-2026-08-16.json", entries: 11 },
    { leg: "jira", file: "brainstorm-jira-2026-08-16.json", entries: 8 },
  ] as const;

  for (const { leg, file, entries } of LEGS) {
    const t = captureExists(file) ? test : test.skip;

    t(`the ${leg} leg's ${entries}-entry capture is measured, not synthetic`, () => {
      const transcript = transcriptOf(file);
      expect(transcript.length).toBe(entries);
      // Non-vacuity for the verdict pin below: the capture really does contain
      // no scaffold write, no ask and no refusal — the AC.5 shape exactly.
      expect(transcript.some((e) => e.type === "refusal")).toBe(false);
      expect(
        transcript.some(
          (e) => e.type === "tool_use" && e.name === "AskUserQuestion",
        ),
      ).toBe(false);
      expect(
        transcript.some(
          (e) =>
            e.type === "tool_use" &&
            ["Write", "Edit", "NotebookEdit"].includes(e.name ?? ""),
        ),
      ).toBe(false);
    });

    t(`the ${leg} leg now scores violation, not vacuous`, () => {
      const v = verdictFor("brainstorm", transcriptOf(file));
      expect(v.line).not.toContain("vacuous");
      expect(v.line.startsWith("brainstorm: violation")).toBe(true);
      expect(v.exitCode).toBe(1);
    });
  }

  const noneT = captureExists("brainstorm-none-2026-08-16.json")
    ? test
    : test.skip;

  noneT("NON-REGRESSION: the none leg's real scaffold verdict is unchanged", () => {
    // History cannot be fixed. This leg genuinely scaffolded at index 7 and
    // must keep saying so, tool and index intact.
    const v = verdictFor(
      "brainstorm",
      transcriptOf("brainstorm-none-2026-08-16.json"),
    );
    expect(v.line).toBe("brainstorm: violation tool=Write index=7");
    expect(v.exitCode).toBe(1);
  });
});

// ===========================================================================
// AC-STE-479.6 — the meta-test the next skill cannot slip past.
// ===========================================================================

describe("AC-STE-479.6 — every FIRST ACTION carrier names the marker", () => {
  const carriers = (): { name: string; body: string }[] =>
    allPluginSkills().filter(({ body }) => firstActionClause(body) !== null);

  test("NON-VACUITY: discovery finds at least the five known carriers", () => {
    // A discovery bug that finds nothing would make the meta-test below pass
    // silently — the exact failure mode this FR exists to close.
    const found = carriers().map((c) => c.name).sort();
    for (const known of KNOWN_FIRST_ACTION_SKILLS) {
      expect(found, `discovery lost ${known}`).toContain(known);
    }
    expect(found.length).toBeGreaterThanOrEqual(
      KNOWN_FIRST_ACTION_SKILLS.length,
    );
  });

  test("NON-VACUITY: the discovery predicate rejects a non-carrier", () => {
    expect(firstActionClause("# Plain\n\nNothing here.\n")).toBeNull();
    expect(firstActionClause(SYNTHETIC_COMPLIANT_CLAUSE)).not.toBeNull();
  });

  test("each carrier's SKILL.md names the canonical refusal marker", () => {
    const offenders = carriers()
      .filter(({ body }) => !body.includes(MARKER))
      .map(({ name }) => name);
    expect(offenders).toEqual([]);
  });

  test("each carrier states the ask-or-refuse alternative in its clause", () => {
    // The marker without the alternative is decorative; the alternative
    // without the marker is unobservable. Both, per carrier.
    const offenders = carriers()
      .filter(({ name, body }) => {
        const clause = firstActionClause(body)!;
        void name;
        return (
          !clause.includes("RequiresInputRefusedError") &&
          !clause.includes("requireOrRefuse")
        );
      })
      .map(({ name }) => name);
    expect(offenders).toEqual([]);
  });
});

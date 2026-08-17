// M127 STE-486 — Phase 4's claim witness must inherit fixture 10a's
// sampling-gap carve-out.
//
// ===========================================================================
// THE DEFECT, AND THE ONE DIRECTION THE REPAIR MAY NOT TAKE
// ===========================================================================
//
// THE MEASURED EVIDENCE. `/tmp/dpt-smoke-none-ste451-lock-samples.log` from the
// 2026-08-16 tracker-less leg is 60 bytes and reads, in full:
//
//     lock-absent fr_01M05MY4CE5DCWW8E26WJQMS6D
//     claim-commit none
//
// So the sampler RAN (the log exists — this is not 10a's fourth state), found
// no lock, and recorded `claim-commit none`. The claim commit nonetheless
// existed in that project's history and the lock had been correctly released.
// The poll call began ~16:06:41, `/implement` claimed 38 s later at 16:07:19,
// and finished inside the same call — so the sampler never fired again and both
// its `lock-*` line and its `claim-commit` line recorded PRE-CLAIM state.
//
// TWO HALVES OF ONE MECHANISM READ THAT SAME LOG AND DISAGREE:
//
//   § Sub-fixture 10a  — "Empty log **but** 10b found the claim commit ⇒ …
//                         Report a `10a-sampling-gap` finding; do NOT fail the
//                         group on this alone."
//   § Phase 4, AC-STE-448.9 (as tightened by STE-456)
//                       — "`claim-commit none`, or no such line at all, is a
//                          **FAIL even with the lock absent**."
//
// The second one FALSE-REDS the healthy run above. The repair extends 10a's
// carve-out TO the Phase 4 row.
//
// *** IT NEVER RUNS THE OTHER WAY. *** Tightening 10a to match Phase 4 would be
// the wrong repair and STE-456 AC.2 already says why: a fixture group that
// false-reds on a healthy short run gets DISABLED by the next operator, which is
// strictly worse than the hole. AC-STE-486.3 is therefore a BYTE-EQUALITY pin on
// 10a's three-case outcome rule and its carve-out paragraph, captured from the
// live file at test-writing time. Any edit to those bytes — including an
// "improvement" — fails this FR.
//
// THE FOUR STATES 10a ALREADY DISTINGUISHES, which the repair must not collapse:
//
//   no log at all                                     ⇒ `10a-sampler-absent`, FAIL
//   log, no `lock-present` line, NO claim commit      ⇒ the claim never wrote, FAIL
//   log, no `lock-present` line, claim commit present ⇒ sampling gap, REPORT not FAIL
//   at least one `lock-present` line                  ⇒ PASS
//
// ===========================================================================
// THE SHAPE THE IMPLEMENTER MUST BUILD
// ===========================================================================
//
//  A. adapters/_shared/src/claim_witness_assert.ts — NEW. The outcome rule as
//     executable code plus a CLI, in the shape `capability_row_assert.ts`
//     already established for fixture rows:
//       SAMPLING_GAP_FINDING   = "10a-sampling-gap"
//       SAMPLER_ABSENT_FINDING = "10a-sampler-absent"
//       type ClaimWitnessOutcome = "pass" | "sampling-gap" | "fail"
//       readClaimCommitSha(logText): string | null
//           the first `claim-commit <sha>` line naming a real sha; `none`, a
//           malformed value, and no line at all all read as null
//       evaluateClaimWitness({ logText, confirmedSha, lockAbsent }): ClaimWitnessVerdict
//           { outcome, finding, sha, line, exitCode } — exit 0 for `pass` AND
//           for `sampling-gap`, 1 for `fail`. `logText: null` means the log does
//           not exist at all, which is `10a-sampler-absent` and always FAIL.
//     CLI: `bun claim_witness_assert.ts <log> <confirmed-sha> [lock-absent|lock-present]`
//          prints the verdict line, exits with `exitCode`.
//
//  B. adapters/_shared/src/shared_carve_out.ts — NEW. AC.4's anti-drift
//     mechanism: ONE authored source, cited rather than restated.
//       carveOutDefinition(skillBody): { section, text }
//           the unique defining site; MORE THAN ONE occurrence throws, so a
//           verbatim restatement is a hard error rather than a silent second copy
//       carveOutCitations(skillBody): readonly { section, text }[]
//       resolveCarveOutFor(skillBody, section): string
//           the carve-out bytes in force at `section` — its own if it defines,
//           the definition's if it cites, a THROW if it neither defines nor cites
//           and a THROW if the citation dangles
//
//  C. `.claude/skills/smoke-test/SKILL.md` § Phase 4 "Tracker-less rows" —
//     AC-STE-448.9's witness paragraph CITES 10a's carve-out by name instead of
//     restating it, drops the unqualified "FAIL even with the lock absent"
//     sentence, and lands ONE executable inline span invoking the runner:
//       bun "${CLAIM_WITNESS}" /tmp/dpt-smoke-<tracker>-ste451-lock-samples.log \
//           "$(git -C "${TP}" log … --grep="^chore(locks): claim lock for ${FR_ID}$" …)" \
//           "$([ -e "${TP}/.dpt/locks/${FR_ID}" ] && echo lock-present || echo lock-absent)"
//     `CLAIM_WITNESS=${PLUGIN_DIR}/adapters/_shared/src/claim_witness_assert.ts`
//     is declared in a fence, the way `CAP_ASSERT` already is. The span reaches
//     the test project through `${TP}`/`${FR_ID}` — NOT a hard-coded path —
//     because the harness binds only the capture-path token and everything else
//     has to come from the environment.
//
//  D. FIXTURES, next to STE-484's and STE-485's:
//       tests/fixtures/m127-falsifiability/lock-samples-none.log
//           the REAL 60-byte 2026-08-16 capture, byte-exact
//       tests/fixtures/m127-falsifiability/lock-samples-none-claimed.log
//           SYNTHETIC (declares itself so in its first line) — the healthy log a
//           leg whose sampler caught the claim would leave. It is the harness's
//           present-subject half; no preserved capture of that shape exists.
//
//  E. falsifiability_harness.ts — STE-486's registry row: site in § Tracker-less
//     rows, `capture: "lock-samples-none-claimed.log"`, subject = the sha the
//     healthy log names, threshold 1, `scoreBy: "exit-code"` (the runner prints a
//     verdict line, so count-scoring reads 1 in BOTH directions and is provably
//     vacuous — the STE-485 lesson).
//
// A THIRD STATEMENT ALREADY EXISTS, and it is deliberately left alone. §
// Sub-fixture 10c's rendering rule ("The one carve-out, stated here because a
// blanket 'any sub-fixture failure' reading would make it invisible…") restates
// the carve-out in its own words for the group's RENDERING. AC.3 does not pin
// it and AC.4 names the two drifted sites, so it is out of scope here — but the
// `carveOutDefinition` anchor must be chosen so that paragraph does not read as
// a second DEFINITION, and it is written down here so the next reader does not
// discover it as a surprise.
//
// `.claude/skills/smoke-test/SKILL.md` lives OUTSIDE `plugins/dev-process-toolkit`
// and therefore carries no line cap and no STE-N token ceiling; ticket ids may be
// cited freely there and here.

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  evaluateClaimWitness,
  readClaimCommitSha,
  SAMPLER_ABSENT_FINDING,
  SAMPLING_GAP_FINDING,
  type ClaimWitnessOutcome,
} from "../adapters/_shared/src/claim_witness_assert";
import {
  bindCapture,
  checkRepairEntry,
  extractAssertionShell,
  FALSIFIABILITY_FIXTURE_DIR,
  M127_REPAIRS,
  M127_REPAIR_ROSTER,
  resolveCapturePath,
  runAssertion,
  SMOKE_SKILL_RELATIVE_PATH,
  uncoveredRepairs,
  type AssertionRun,
  type RepairEntry,
} from "../adapters/_shared/src/falsifiability_harness";
import {
  carveOutDefinition,
  resolveCarveOutFor,
} from "../adapters/_shared/src/shared_carve_out";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const SMOKE_SKILL = join(REPO_ROOT, SMOKE_SKILL_RELATIVE_PATH);
const SKILL_BODY = readFileSync(SMOKE_SKILL, "utf8");

/** The two sections whose one rule drifted apart. */
const TEN_A_SECTION = "Sub-fixture 10a";
const PHASE4_SECTION = "Tracker-less rows";

/** The FR minted on the 2026-08-16 tracker-less leg. Real, measured. */
const FR_ID = "fr_01M05MY4CE5DCWW8E26WJQMS6D";

/** The runner the SKILL's Phase 4 span invokes, and the env name it reaches it by. */
const RUNNER_RELATIVE = "adapters/_shared/src/claim_witness_assert.ts";

process.env.PLUGIN_DIR = PLUGIN_ROOT;
process.env.CLAIM_WITNESS = join(PLUGIN_ROOT, RUNNER_RELATIVE);
process.env.FR_ID = FR_ID;

const TMP = mkdtempSync(join(tmpdir(), "dpt-ste486-"));
afterAll(() => rmSync(TMP, { recursive: true, force: true }));

// ---------------------------------------------------------------------------
// Fixtures and temp projects
// ---------------------------------------------------------------------------

/** The REAL 2026-08-16 capture, byte-exact — the whole subject of this FR. */
const REAL_LOG_BYTES = `lock-absent ${FR_ID}\nclaim-commit none\n`;
const REAL_LOG = join(FALSIFIABILITY_FIXTURE_DIR, "lock-samples-none.log");
const HEALTHY_LOG = join(FALSIFIABILITY_FIXTURE_DIR, "lock-samples-none-claimed.log");

function tempLog(name: string, body: string): string {
  const path = join(TMP, name);
  writeFileSync(path, body, "utf8");
  return path;
}

/**
 * A throwaway test project. `claimFor` non-null puts a REAL claim commit in its
 * history and then releases the lock again — which is precisely the disk a
 * healthy `mode: none` run leaves behind, and the state the current Phase 4 row
 * fails on. `null` builds the project where the claim genuinely never happened.
 */
function initProject(name: string, claimFor: string | null): string {
  const dir = join(TMP, name);
  mkdirSync(dir, { recursive: true });
  const git = (...args: string[]): void => {
    const run = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
    if ((run.status ?? 1) !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${run.stderr}`);
    }
  };
  git("init", "-q", "-b", "main");
  git("config", "user.email", "smoke@example.invalid");
  git("config", "user.name", "DPT Smoke");
  git("config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "README.md"), "seed\n", "utf8");
  git("add", "-A");
  git("commit", "-q", "-m", "chore: seed");
  if (claimFor !== null) {
    const locks = join(dir, ".dpt", "locks");
    mkdirSync(locks, { recursive: true });
    writeFileSync(join(locks, claimFor), `ulid: ${claimFor}\nbranch: feat/smoke\n`, "utf8");
    git("add", "-A");
    git("commit", "-q", "-m", `chore(locks): claim lock for ${claimFor}`);
    rmSync(join(locks, claimFor));
    git("add", "-A");
    git("commit", "-q", "-m", "chore(locks): release lock");
  }
  return dir;
}

/** History carries the claim commit; the lock is gone. The healthy end state. */
const PROJECT_CLAIMED = initProject("tp-claimed", FR_ID);
/** The claim genuinely never happened. Nothing to confirm, anywhere. */
const PROJECT_UNCLAIMED = initProject("tp-unclaimed", null);

/** The claim sha `PROJECT_CLAIMED` actually recorded, read back from git. */
function confirmedShaIn(project: string): string {
  const run = spawnSync(
    "git",
    [
      "-C",
      project,
      "log",
      "--format=%H",
      "-1",
      "--basic-regexp",
      `--grep=^chore(locks): claim lock for ${FR_ID}$`,
    ],
    { encoding: "utf8" },
  );
  return (run.stdout ?? "").trim();
}

// ---------------------------------------------------------------------------
// The SKILL's own bytes — extracted, never paraphrased
// ---------------------------------------------------------------------------

/** STE-486's registry row. */
function repairEntry(): RepairEntry {
  const entry = M127_REPAIRS.find((row) => row.id === "STE-486");
  expect(entry).toBeDefined();
  return entry as RepairEntry;
}

/** The Phase 4 row's executable span, verbatim from the SKILL. */
function rowShell(): string {
  return extractAssertionShell(SKILL_BODY, repairEntry().site).shell;
}

/**
 * Slice a section body: its heading to the next same-or-shallower heading.
 *
 * FENCE-AWARE ON PURPOSE. § Sub-fixture 10a's sampler fence opens with
 * `# Group 10 sampler — run ONCE PER step-3 poll call…`, and a naive
 * `\n#{1,5} ` search treats that shell comment as the next heading — which
 * truncates 10a to 351 bytes, three lines short of the outcome rule this FR
 * pins. A slicer that stops inside the very block it is asked to read would
 * report the carve-out ABSENT and pass every "not restated" assertion below for
 * the wrong reason.
 */
function section(needle: string): string {
  const lines = SKILL_BODY.split("\n");
  const offsets: number[] = [];
  let at = 0;
  for (const line of lines) {
    offsets.push(at);
    at += line.length + 1;
  }

  const headings: { index: number; depth: number }[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    if (/^[ \t]*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const heading = /^(#{1,6})[ \t]+(.*)$/.exec(line);
    if (heading) headings.push({ index: i, depth: (heading[1] as string).length });
  }

  const hits = headings.filter(({ index }) => (lines[index] as string).includes(needle));
  expect(hits.length).toBe(1);
  const { index, depth } = hits[0] as { index: number; depth: number };
  const next = headings.find((h) => h.index > index && h.depth <= depth);
  const start = offsets[index] as number;
  return next ? SKILL_BODY.slice(start, offsets[next.index] as number) : SKILL_BODY.slice(start);
}

/** Run the SKILL's own bytes against one log, with one project in scope. */
function runRow(logPath: string, project: string): AssertionRun {
  process.env.TP = project;
  process.env.FR_ID = FR_ID;
  return runAssertion(bindCapture(rowShell(), logPath));
}

// ---------------------------------------------------------------------------
// AC-STE-486.1 — the sampling gap is REPORTED, not failed.
//
// Both halves are pinned: the outcome rule as code, and the SKILL's own span
// executed against the real capture with a project whose history confirms the
// claim. Prose alone would not prove the row's behaviour changed.
// ---------------------------------------------------------------------------

describe("AC-STE-486.1 — a confirmed claim turns the missing line into a report, not a failure", () => {
  test("the shipped fixture IS the measured capture, byte for byte", () => {
    expect(existsSync(REAL_LOG)).toBe(true);
    expect(readFileSync(REAL_LOG, "utf8")).toBe(REAL_LOG_BYTES);
    // The log EXISTS and names no sha. That is the sampling gap, and it is not
    // the fourth state — conflating the two is how the carve-out gets lost.
    expect(readClaimCommitSha(REAL_LOG_BYTES)).toBeNull();
  });

  test("the outcome rule reports the gap when the claim is independently confirmed", () => {
    const verdict = evaluateClaimWitness({
      logText: REAL_LOG_BYTES,
      confirmedSha: "b17c93f0e1d2c3b4a596877665544332211000ff",
      lockAbsent: true,
    });
    expect(verdict.outcome).toBe("sampling-gap" satisfies ClaimWitnessOutcome);
    expect(verdict.finding).toBe(SAMPLING_GAP_FINDING);
    expect(verdict.exitCode).toBe(0);
    expect(verdict.line).toContain(SAMPLING_GAP_FINDING);
  });

  test("the SKILL's own span exits 0 on the real capture when history confirms", () => {
    expect(confirmedShaIn(PROJECT_CLAIMED)).not.toBe("");
    const run = runRow(REAL_LOG, PROJECT_CLAIMED);
    expect(run.exitCode).toBe(0);
    expect(run.stdout).toContain(SAMPLING_GAP_FINDING);
  });

  test("the gap is surfaced, never swallowed — a report is not a silent pass", () => {
    const run = runRow(REAL_LOG, PROJECT_CLAIMED);
    // A green row that says nothing is the other failure mode: the operator has
    // to learn the sampler missed its window, which is a real driver finding.
    expect(run.stdout).not.toBe("");
    expect(run.stdout).not.toContain("pass\n");
    const verdict = evaluateClaimWitness({
      logText: REAL_LOG_BYTES,
      confirmedSha: confirmedShaIn(PROJECT_CLAIMED),
      lockAbsent: true,
    });
    expect(verdict.outcome).not.toBe("pass");
  });

  test("a log with no `claim-commit` line at all is the same gap, not a new state", () => {
    const partial = `lock-absent ${FR_ID}\n`;
    expect(readClaimCommitSha(partial)).toBeNull();
    expect(
      evaluateClaimWitness({ logText: partial, confirmedSha: "b17c93f0e1d2c3b4a5968776655443322110", lockAbsent: true })
        .outcome,
    ).toBe("sampling-gap");
    const run = runRow(tempLog("no-claim-line.log", partial), PROJECT_CLAIMED);
    expect(run.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-486.2 — the carve-out NARROWS the failure; it does not remove it.
//
// The whole risk of this repair is over-correcting into a row that can no longer
// fail. Every state that should still be red is executed here.
// ---------------------------------------------------------------------------

describe("AC-STE-486.2 — the row still fails when the claim genuinely never happened", () => {
  test("no line, no confirmation ⇒ FAIL", () => {
    const verdict = evaluateClaimWitness({
      logText: REAL_LOG_BYTES,
      confirmedSha: null,
      lockAbsent: true,
    });
    expect(verdict.outcome).toBe("fail");
    expect(verdict.exitCode).not.toBe(0);
  });

  test("the SKILL's own span is RED against a project with no claim commit", () => {
    expect(confirmedShaIn(PROJECT_UNCLAIMED)).toBe("");
    expect(runRow(REAL_LOG, PROJECT_UNCLAIMED).exitCode).not.toBe(0);
  });

  test("an empty confirmation string is not a confirmation", () => {
    // `$(git log … || true)` yields "" on a project with no such commit, and a
    // truthiness bug here would bless every failing run.
    expect(
      evaluateClaimWitness({ logText: REAL_LOG_BYTES, confirmedSha: "", lockAbsent: true }).outcome,
    ).toBe("fail");
  });

  test("no log AT ALL is `10a-sampler-absent` and FAILS even when history confirms", () => {
    const verdict = evaluateClaimWitness({
      logText: null,
      confirmedSha: confirmedShaIn(PROJECT_CLAIMED),
      lockAbsent: true,
    });
    expect(verdict.outcome).toBe("fail");
    expect(verdict.finding).toBe(SAMPLER_ABSENT_FINDING);
    // Through the SKILL's own bytes, on a path that does not exist.
    expect(runRow(join(TMP, "no-such-lock-samples.log"), PROJECT_CLAIMED).exitCode).not.toBe(0);
  });

  test("a surviving lock FAILS even with the claim commit named", () => {
    const named = `lock-absent ${FR_ID}\nclaim-commit ${confirmedShaIn(PROJECT_CLAIMED)}\n`;
    expect(
      evaluateClaimWitness({ logText: named, confirmedSha: null, lockAbsent: false }).outcome,
    ).toBe("fail");
  });

  test("a log naming a real sha PASSES outright — the carve-out is not the only path", () => {
    const named = `lock-present ${FR_ID}\nclaim-commit ${confirmedShaIn(PROJECT_CLAIMED)}\n`;
    expect(readClaimCommitSha(named)).toBe(confirmedShaIn(PROJECT_CLAIMED));
    const verdict = evaluateClaimWitness({ logText: named, confirmedSha: null, lockAbsent: true });
    expect(verdict.outcome).toBe("pass");
    expect(verdict.finding).toBeNull();
    // …and the span agrees, on a project that confirms nothing.
    expect(runRow(tempLog("named.log", named), PROJECT_UNCLAIMED).exitCode).toBe(0);
  });

  test("`claim-commit none` is read as no sha, not as a sha spelled `none`", () => {
    expect(readClaimCommitSha("claim-commit none\n")).toBeNull();
    expect(readClaimCommitSha("claim-commit \n")).toBeNull();
    expect(readClaimCommitSha("claim-commit not-a-sha\n")).toBeNull();
    // A sha anywhere in the log is durable evidence, whichever sample recorded it.
    expect(readClaimCommitSha("claim-commit none\nclaim-commit abcdef1234567\n")).toBe(
      "abcdef1234567",
    );
  });

  test("the row's prose still states the failure, and no longer states it absolutely", () => {
    const phase4 = section(PHASE4_SECTION);
    // The unqualified tightening is the defect itself: it admits no exception.
    expect(phase4).not.toContain(
      "`claim-commit none`, or no such line at all, is a **FAIL even with the lock absent**",
    );
    // But the failure has to survive in the prose too, or the row reads as
    // having been deleted rather than narrowed.
    expect(phase4).toMatch(/FAIL|fails/);
    expect(phase4).toContain("STE-486");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-486.3 — 10a is BYTE-UNCHANGED. Direction matters.
//
// These bytes were captured from the live file at test-writing time. The pin is
// deliberately one-directional: STE-456 AC.2 says a group that false-reds on a
// healthy short run gets disabled, so narrowing 10a to match Phase 4 is worse
// than the hole this FR closes.
// ---------------------------------------------------------------------------

const TEN_A_OUTCOME_RULE = [
  "**10a is sampling-dependent, and its empty case is NOT automatically a group failure. Read this before treating a blank log as a red.** Each poll call covers up to 18 checks × 30 s, and the sampler runs once per *call*, not once per check. If `/implement` happens to complete inside a single poll call the sampler may fire once — possibly before § 0.c has claimed — and find nothing on a perfectly healthy run. So the outcome rule is:",
  "",
  "- Empty log **and** 10b found no claim commit ⇒ the claim genuinely never wrote. **10a FAIL.**",
  "- Empty log **but** 10b found the claim commit ⇒ the lock demonstrably existed and the sampler missed its window. **Report a `10a-sampling-gap` finding; do NOT fail the group on this alone** — a false RED on a healthy run is the other half of the vacuity this milestone hunts, and 10b is the authority precisely because it cannot miss.",
  "- At least one `lock-present` line ⇒ **10a PASS**, and the id on it must equal the resolver's `FR_ID`.",
  "",
  "That asymmetry is deliberate and it is the honest statement of what a sampled observation can prove: it can confirm presence, it cannot prove absence.",
].join("\n");

describe("AC-STE-486.3 — fixture 10a's outcome rule and carve-out are byte-unchanged", () => {
  test("the pinned block is present, byte for byte", () => {
    expect(SKILL_BODY).toContain(TEN_A_OUTCOME_RULE);
  });

  test("it appears exactly once — not tightened, and not copied elsewhere", () => {
    expect(SKILL_BODY.split(TEN_A_OUTCOME_RULE).length - 1).toBe(1);
  });

  test("it lives inside § Sub-fixture 10a and nowhere else", () => {
    expect(section(TEN_A_SECTION)).toContain(TEN_A_OUTCOME_RULE);
    expect(section(PHASE4_SECTION)).not.toContain(TEN_A_OUTCOME_RULE);
  });

  test("the three cases and the fourth state are all still distinguishable", () => {
    const tenA = section(TEN_A_SECTION);
    expect(tenA).toContain(SAMPLING_GAP_FINDING);
    expect(tenA).toContain(SAMPLER_ABSENT_FINDING);
    // The tolerance is intact: nothing in 10a has grown an unconditional FAIL
    // on the carve-out's own case.
    expect(tenA).toContain("do NOT fail the group on this alone");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-486.4 — ONE authored source, cited rather than restated.
//
// The defect is a drift between two statements of one rule. A repair that
// re-states the carve-out in prose at the Phase 4 row RE-CREATES it — later,
// quietly, and with the same excuse. So the two sites must resolve to the SAME
// bytes, editing the source must move both, and deleting the source must break
// both rather than leave Phase 4 holding a private copy.
// ---------------------------------------------------------------------------

describe("AC-STE-486.4 — the carve-out is shared between the two sites, not restated", () => {
  test("there is exactly ONE defining site, and it is 10a", () => {
    const definition = carveOutDefinition(SKILL_BODY);
    expect(definition.section).toContain(TEN_A_SECTION);
    expect(TEN_A_OUTCOME_RULE).toContain(definition.text);
    expect(definition.text.length).toBeGreaterThan(0);
  });

  test("both sites resolve to the SAME bytes", () => {
    const fromTenA = resolveCarveOutFor(SKILL_BODY, TEN_A_SECTION);
    const fromPhase4 = resolveCarveOutFor(SKILL_BODY, PHASE4_SECTION);
    expect(fromPhase4).toBe(fromTenA);
    expect(fromTenA).toBe(carveOutDefinition(SKILL_BODY).text);
  });

  test("the Phase 4 row CITES the carve-out by name and by section", () => {
    const phase4 = section(PHASE4_SECTION);
    expect(phase4).toContain(SAMPLING_GAP_FINDING);
    expect(phase4).toContain(TEN_A_SECTION);
  });

  test("the Phase 4 row does not RESTATE the rule's operative wording", () => {
    const phase4 = section(PHASE4_SECTION);
    // The exact phrases whose duplication is the defect. A second copy of any of
    // them is a second authored source, whatever it is labelled.
    expect(phase4).not.toContain("do NOT fail the group on this alone");
    expect(phase4).not.toContain("the sampler missed its window");
    expect(phase4).not.toContain("So the outcome rule is:");
  });

  test("editing the source moves BOTH sites — that is what shared means", () => {
    const edited = SKILL_BODY.replace(
      "do NOT fail the group on this alone",
      "do NOT fail the group on this alone (edited)",
    );
    expect(edited).not.toBe(SKILL_BODY);
    const fromTenA = resolveCarveOutFor(edited, TEN_A_SECTION);
    const fromPhase4 = resolveCarveOutFor(edited, PHASE4_SECTION);
    expect(fromPhase4).toBe(fromTenA);
    expect(fromPhase4).toContain("(edited)");
  });

  test("deleting the source breaks BOTH — Phase 4 keeps no private copy", () => {
    const deleted = SKILL_BODY.split(TEN_A_OUTCOME_RULE).join("");
    expect(() => resolveCarveOutFor(deleted, TEN_A_SECTION)).toThrow();
    expect(() => resolveCarveOutFor(deleted, PHASE4_SECTION)).toThrow();
  });

  test("a verbatim second copy is a hard error, not a silent duplicate", () => {
    // The counterfactual, executed: this is the SKILL the naive repair produces.
    const restated = SKILL_BODY.replace(
      "##### Tracker-less rows",
      `${TEN_A_OUTCOME_RULE}\n\n##### Tracker-less rows`,
    );
    expect(restated).not.toBe(SKILL_BODY);
    expect(() => carveOutDefinition(restated)).toThrow();
  });

  test("a section that neither defines nor cites cannot resolve the rule", () => {
    // 10b is the carve-out's own AUTHORITY and still never states the rule —
    // resolution has to refuse rather than hand back the definition to any
    // section that happens to ask, or "shared" degrades to "globally readable".
    expect(section("Sub-fixture 10b")).not.toContain(SAMPLING_GAP_FINDING);
    expect(() => resolveCarveOutFor(SKILL_BODY, "Sub-fixture 10b")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// AC-STE-486.5 — STE-483's harness, on the SKILL's own bytes.
//
// The present half is a healthy log naming a real sha; the absent half is that
// same log with the sha deleted, run against a project where the claim GENUINELY
// never happened. The choice of project is load-bearing and is proved so below:
// against a confirming project both halves are green and the row is vacuous.
// ---------------------------------------------------------------------------

describe("AC-STE-486.5 — the harness proves the row still fails on a genuine absence", () => {
  test("STE-486 is registered, names a SITE, and carries no shell", () => {
    expect(uncoveredRepairs(M127_REPAIRS, M127_REPAIR_ROSTER)).not.toContain("STE-486");
    const entry = repairEntry();
    expect(Object.keys(entry)).not.toContain("shell");
    expect(Object.keys(entry)).not.toContain("command");
    expect(entry.site.section).toContain(PHASE4_SECTION);
    expect(entry.leg).toBe("none");
    // The runner prints a verdict line, so stdout counting reads 1 in BOTH
    // directions. Exit-code scoring is the only non-vacuous reading (STE-485).
    expect(entry.scoreBy).toBe("exit-code");
  });

  test("the row measures a lock-samples capture, not an /implement one", () => {
    const path = resolveCapturePath(repairEntry());
    expect(path).toBe(HEALTHY_LOG);
    expect(existsSync(path)).toBe(true);
    const body = readFileSync(path, "utf8");
    // Hand-built, and it says so in its own bytes: no preserved capture of a
    // caught claim exists, and a fixture that poses as a real one is the defect
    // class this milestone removes.
    expect(body).toMatch(/SYNTHETIC/);
    expect(readClaimCommitSha(body)).toBe(repairEntry().subject);
  });

  test("the extracted span is the SKILL's own bytes and reaches the project by env", () => {
    const shell = rowShell();
    expect(SKILL_BODY).toContain(shell);
    expect(shell).toContain(RUNNER_RELATIVE.split("/").pop() as string);
    expect(shell).toContain("/tmp/dpt-smoke-<tracker>-ste451-lock-samples.log");
    expect(shell).toContain("chore(locks): claim lock for");
    expect(shell).toContain("--basic-regexp");
    expect(shell).toContain("${TP}");
    expect(shell).toContain("${FR_ID}");
  });

  test("the SKILL declares the runner the way it declares CAP_ASSERT", () => {
    expect(SKILL_BODY).toMatch(
      /CLAIM_WITNESS=\$\{PLUGIN_DIR\}\/adapters\/_shared\/src\/claim_witness_assert\.ts/,
    );
  });

  test("checkRepairEntry scores STE-486 FALSIFIABLE against an unclaimed project", () => {
    process.env.TP = PROJECT_UNCLAIMED;
    process.env.FR_ID = FR_ID;
    const result = checkRepairEntry(repairEntry(), SKILL_BODY);
    expect(result.id).toBe("STE-486");
    expect(result.removed).toBeGreaterThan(0);
    expect(result.presentCount).toBeGreaterThanOrEqual(repairEntry().threshold);
    expect(result.absentCount).toBeLessThan(repairEntry().threshold);
    expect(result.verdict).toBe("falsifiable");
  });

  test("a confirming project makes the SAME pair vacuous — the carve-out working", () => {
    // Not a defect: it is the carve-out doing its job, and it is why the harness
    // half has to run against a project where the claim never happened.
    const healthy = readFileSync(HEALTHY_LOG, "utf8");
    const stripped = healthy.split(repairEntry().subject).join("");
    expect(stripped).not.toBe(healthy);
    const strippedPath = tempLog("sha-removed.log", stripped);
    expect(runRow(strippedPath, PROJECT_CLAIMED).exitCode).toBe(0);
    expect(runRow(strippedPath, PROJECT_UNCLAIMED).exitCode).not.toBe(0);
  });

  test("a drifted SKILL throws rather than falling back to a remembered form", () => {
    const entry = repairEntry();
    const drifted = SKILL_BODY.split(entry.site.select).join("no-such-token");
    expect(() => checkRepairEntry(entry, drifted)).toThrow();
  });
});

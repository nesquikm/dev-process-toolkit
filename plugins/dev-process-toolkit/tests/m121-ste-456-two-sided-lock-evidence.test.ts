// STE-456 — make the tracker-less lock evidence TWO-SIDED and capture it before
// the phases a post-chain kill forfeits (M121).
//
// WHAT THIS FILE IS FOR, stated first because it changes how to read every
// assertion below. On 2026-08-08 the tracker-less leg ran for the first time.
// All three canonical chains COMPLETED and all three legs were then killed
// before Phase 2.X — so fixture group 10, the surface built to observe the lock
// lifecycle, rendered no verdict at all. Meanwhile § Phase 4's release-proof row
// scored GREEN, because the lock was absent. It was absent because it had never
// been created: `/implement` under `mode: none` never claimed it (finding F1).
//
// That is the vacuous pass the row's own prose warns about, arriving on the
// first live run of the leg. Two separate defects produced it:
//
//   (i)  the evidence was ONE-SIDED — the sampler appended only on a hit, so a
//        sampler that never ran and a sampler that ran and found nothing left
//        BYTE-IDENTICAL disk, and neither could be told from the other;
//   (ii) the release proof required ABSENCE ALONE, which a claim that never
//        fired satisfies exactly as well as a release that worked.
//
// AC.1 fixes (i), AC.3 makes the evidence durable inside the chain, AC.4 fixes
// (ii). AC.8 is the one that matters: the detection is proved RED against the
// defect WHILE THE DEFECT IS STILL LIVE. STE-457 removes it, and after that
// every proof is against a reconstruction written by the party being tested.
//
// WHAT IS EXECUTED AND WHAT IS PROSE — the distinction this milestone punishes
// conflating, so it is drawn once, here:
//
//   EXECUTED. The sampler and witness fences are EXTRACTED from the shipped
//   driver and run under bash against a real git repository whose lock was
//   written by the real `LocalProvider.claimLock`. Nothing below paraphrases a
//   fence it then tests.
//
//   ANALOGUE. `releaseProofRow` is a TypeScript reading of § Phase 4's row,
//   which is PROSE a model executes at runtime — there is no fence to lift. Its
//   INPUTS, however, are produced by the extracted fences, so what is modelled
//   is the decision, never the evidence. Said plainly rather than left for a
//   reader to discover.

import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bashFences } from "./_fence";
import {
  AC9_DISCLAIMER_PINS,
  AC9_WINDOW,
  PRESENCE_CLAIM_TRIPWIRE,
  PRESENCE_CLAIM_TRIPWIRE_PRE_456,
  ac9Row,
  ac9Window,
  assertAnchorUnique,
} from "./_ac9-row-guard";
import { LocalProvider } from "../adapters/_shared/src/local_provider";
import { locksDir } from "../adapters/_shared/src/dpt_paths";
import { mintId } from "../adapters/_shared/src/ulid";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const SMOKE_SKILL = join(REPO_ROOT, ".claude/skills/smoke-test/SKILL.md");

function read(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

const smokeDoc = read(SMOKE_SKILL);
const describeIfSkills = smokeDoc === null ? describe.skip : describe;

describe("STE-456 — the document under test was actually found", () => {
  test("the smoke driver resolves, so the suite below is not silently skipped", () => {
    // Without this, a moved SKILL turns every `describeIfSkills` into a silent
    // skip and the file reports success while testing nothing.
    expect(smokeDoc).not.toBeNull();
    expect(smokeDoc!.length).toBeGreaterThan(10_000);
  });
});

// ════════════════════════════ the executed harness ═══════════════════════════

const GROUP10_RE = /#### Fixture group 10 — [\s\S]*?(?=\n#### |\n### |$)/;
const SAMPLE_LOG_LITERAL = "/tmp/dpt-smoke-<tracker>-ste451-lock-samples.log";

function group10Fences(): string[] {
  return bashFences(GROUP10_RE.exec(smokeDoc ?? "")?.[0] ?? "");
}

interface Fixture {
  root: string;
  frId: string;
  tail: string;
  branch: string;
  log: string;
}

function git(cwd: string, ...args: string[]): string {
  const p = Bun.spawnSync({ cmd: ["git", ...args], cwd });
  if (p.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed in ${cwd}: ${new TextDecoder().decode(p.stderr)}`,
    );
  }
  return new TextDecoder().decode(p.stdout).trim();
}

/** A real `mode: none` project. The claim is NOT made here — each test decides. */
function buildFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "ste456-lock-"));
  const branch = "feat/m121-ste-456-fixture";
  git(root, "init", "--quiet");
  git(root, "symbolic-ref", "HEAD", `refs/heads/${branch}`);
  git(root, "config", "user.email", "ste456@example.invalid");
  git(root, "config", "user.name", "STE-456 Fixture");

  const frId = mintId();
  const tail = frId.slice(23, 29);
  mkdirSync(join(root, "specs", "frs"), { recursive: true });
  writeFileSync(
    join(root, "specs", "frs", `${tail}.md`),
    [
      "---",
      'title: "Group 10 fixture FR"',
      `id: ${frId}`,
      "milestone: M_FIXTURE",
      "status: active",
      "---",
      "",
      "# Group 10 fixture FR",
      "",
    ].join("\n"),
  );
  git(root, "add", "-A");
  git(root, "commit", "--quiet", "-m", "chore: seed the tracker-less fixture");
  return { root, frId, tail, branch, log: join(root, "samples.log") };
}

function cleanup(f: Fixture): void {
  rmSync(f.root, { recursive: true, force: true });
}

async function claim(f: Fixture): Promise<void> {
  await new LocalProvider({ repoRoot: f.root, skipFetch: true }).claimLock(
    f.frId,
    f.branch,
  );
}

/**
 * What `/implement` Phase 4 Close step (b) does for `mode: none`: delete the
 * lock. `claimLock` COMMITTED it, so the deletion is committed too — which is
 * why the witness outlives the file.
 */
function release(f: Fixture): void {
  rmSync(join(locksDir(f.root), f.frId), { force: true });
  git(f.root, "add", "-A");
  git(f.root, "commit", "--quiet", "-m", "chore(locks): release lock");
}

/**
 * Aim a fence at a real tree and ASSERT the substitution landed.
 *
 * follow-ups § 0b: a substitution that silently misses puts every artifact
 * where no assertion looks, and the whole run then reads as "the code under
 * test does nothing" rather than "the harness is misconfigured".
 */
function aim(fence: string, f: Fixture): string {
  let out = fence.replace("TP=../dpt-test-project-none", `TP=${f.root}`);
  out = out.replace(SAMPLE_LOG_LITERAL, f.log);
  if (out === fence) {
    throw new Error("aim: neither substitution applied — a fence changed shape");
  }
  return out;
}

function runBash(script: string): { code: number; out: string; err: string } {
  const p = Bun.spawnSync({ cmd: ["bash", "-c", script] });
  return {
    code: p.exitCode ?? -1,
    out: new TextDecoder().decode(p.stdout),
    err: new TextDecoder().decode(p.stderr),
  };
}

/** Run the resolver fence, then the sampler fence, exactly as step 3 does. */
function sample(f: Fixture): { code: number; err: string } {
  const fences = group10Fences();
  const r = runBash(`${aim(fences[0]!, f)}\n${aim(fences[1]!, f)}`);
  return { code: r.code, err: r.err };
}

function logLines(f: Fixture): string[] | null {
  if (!existsSync(f.log)) return null;
  const body = readFileSync(f.log, "utf8").trim();
  return body === "" ? [] : body.split("\n");
}

// ═════════════════════════════ AC-STE-456.1 ══════════════════════════════════

describeIfSkills("AC-STE-456.1 — the sampler writes on EVERY sample", () => {
  test("EXECUTED: the discriminating pair — never-ran vs ran-and-missed", () => {
    // THE ASSERTION THIS FR EXISTS TO MAKE POSSIBLE, and the one that could not
    // be faked. Before this change both states left NO FILE. Writing a line on
    // every sample is easy; writing one that DISTINGUISHES is the point, so the
    // two states are staged side by side and compared as artifacts.
    const neverRan = buildFixture();
    const ranAndMissed = buildFixture();
    try {
      // (1) the sampler never ran: nothing touches the log at all.
      expect(logLines(neverRan)).toBeNull();

      // (2) the sampler ran, twice, and the lock was never there to find.
      sample(ranAndMissed);
      sample(ranAndMissed);
      const lines = logLines(ranAndMissed);

      // DIFFERENT FILES — the whole claim, asserted as an artifact comparison
      // rather than as a property of one of them.
      expect({
        neverRan: logLines(neverRan),
        ranAndMissedExists: lines !== null,
      }).toEqual({ neverRan: null, ranAndMissedExists: true });

      // …and the ran-and-missed file says so positively, twice — one sample
      // verdict and one witness snapshot per call.
      expect(lines).toEqual([
        `lock-absent ${ranAndMissed.frId}`,
        "claim-commit none",
        `lock-absent ${ranAndMissed.frId}`,
        "claim-commit none",
      ]);
    } finally {
      cleanup(neverRan);
      cleanup(ranAndMissed);
    }
  });

  test("EXECUTED: a hit still latches, and names the resolved id", async () => {
    // The paired positive. Without it, "the sampler writes on a miss" is also
    // satisfied by a sampler that writes `lock-absent` unconditionally.
    const f = buildFixture();
    try {
      await claim(f);
      sample(f);
      expect(logLines(f)).toEqual([
        `lock-present ${f.frId}`,
        expect.stringMatching(/^claim-commit [0-9a-f]{40}$/) as unknown as string,
      ]);
    } finally {
      cleanup(f);
    }
  });

  test("EXECUTED: an unresolvable identity still writes a line, and says so", () => {
    // The state that used to be invisible twice over: the resolver refuses AND
    // the sampler stays silent, so the log's absence meant nothing at all.
    const f = buildFixture();
    try {
      rmSync(join(f.root, "specs", "frs"), { recursive: true, force: true });
      const r = sample(f);
      expect(r.err).toContain("10-identity-ambiguous");
      expect(logLines(f)).toEqual(["lock-absent <unresolved>", "claim-commit none"]);
    } finally {
      cleanup(f);
    }
  });

  test("the fence is unconditional — the `else` arm is present in the shipped bytes", () => {
    // The fourth state's whole meaning rests on this arm. The driver's own
    // prose says so, and this is the assertion that makes deleting it LOUD:
    // without the else, an absent log silently becomes ambiguous again while
    // the outcome rule goes on reading it as "the sampler never ran".
    const sampler = group10Fences()[1]!;
    expect(sampler).toContain('echo "lock-present ${FR_ID}" >> "${LOG}"');
    expect(sampler).toContain("else");
    expect(sampler).toContain('echo "lock-absent ${FR_ID:-<unresolved>}" >> "${LOG}"');
  });
});

// ═════════════════════════════ AC-STE-456.2 ══════════════════════════════════
//
// The outcome rule and the carve-out are BYTE-IDENTICAL, and the reason is not
// tidiness. A fixture group that false-REDs on a healthy short run gets
// disabled within two releases, which is strictly worse than the hole it was
// meant to close. AC.1 adds a STATE the latch could not express; it does not
// narrow a tolerance, and these pins are what stop a later editor doing so by
// accident while believing they are tightening the group.

const RULE_CASE_1 =
  "- Empty log **and** 10b found no claim commit ⇒ the claim genuinely never wrote. **10a FAIL.**";
const RULE_CASE_2 =
  "- Empty log **but** 10b found the claim commit ⇒ the lock demonstrably existed and the sampler missed its window. **Report a `10a-sampling-gap` finding; do NOT fail the group on this alone** — a false RED on a healthy run is the other half of the vacuity this milestone hunts, and 10b is the authority precisely because it cannot miss.";
const RULE_CASE_3 =
  "- At least one `lock-present` line ⇒ **10a PASS**, and the id on it must equal the resolver's `FR_ID`.";
const CARVE_OUT =
  '**The one carve-out, stated here because a blanket "any sub-fixture failure" reading would make it invisible: the `10a-sampling-gap` outcome is NOT a sub-fixture failure and MUST NOT render `FAIL`.**';

const BYTE_IDENTICAL: ReadonlyArray<[string, string]> = [
  ["outcome rule case 1", RULE_CASE_1],
  ["outcome rule case 2", RULE_CASE_2],
  ["outcome rule case 3", RULE_CASE_3],
  ["the 10a-sampling-gap carve-out", CARVE_OUT],
];

describeIfSkills("AC-STE-456.2 — the outcome rule and carve-out are byte-identical", () => {
  test("every clause survives verbatim, exactly once", () => {
    for (const [name, text] of BYTE_IDENTICAL) {
      const occurrences = smokeDoc!.split(text).length - 1;
      expect({ name, occurrences }).toEqual({ name, occurrences: 1 });
    }
  });

  test("the pin BITES — a one-character edit to any clause turns it RED", () => {
    // NON-VACUITY, run as a standing in-memory witness rather than described.
    // A `toContain` over a long literal looks unfalsifiable until you watch it
    // fail; this milestone has shipped `VERIFY: OK` printed over an empty set,
    // so the floor is that every pin is seen failing at least once.
    for (const [name, text] of BYTE_IDENTICAL) {
      // Swap the LAST character — a rewording at the end of a clause is the
      // realistic drift, and it is the half a prefix-anchored pin would miss.
      const mutated = smokeDoc!.replace(
        text,
        `${text.slice(0, -1)}${text.slice(-1) === "." ? "!" : "."}`,
      );
      expect(mutated).not.toBe(smokeDoc!); // the mutation applied
      expect({ name, stillPresent: mutated.includes(text) }).toEqual({
        name,
        stillPresent: false,
      });
    }
  });

  test("the carve-out's operative sentences are unchanged too, not just its heading", () => {
    // Pinning the BOLD LEAD-IN alone would be pinning the summary of a
    // mechanism rather than the mechanism — the error M121 recorded at
    // milestone level after STE-452. These are the sentences that decide.
    const carveOutTail =
      "An empty sample log **with** 10b's claim commit present means the lock demonstrably existed and the sampler's cadence missed it — the group still renders `PASS`, and the gap is surfaced as its own finding in the Phase 3 findings file.";
    expect(smokeDoc!.split(carveOutTail).length - 1).toBe(1);
  });

  test("the fourth state is declared OUTSIDE the pinned clauses", () => {
    // The structural half of AC.2: the new state must not be smuggled into the
    // rule it promises not to touch. It lives in its own paragraph, after the
    // rule, and says in its own words that the three cases are unchanged.
    const fourth = "**A FOURTH STATE, and the three cases above are unchanged (STE-456).**";
    expect(smokeDoc!.split(fourth).length - 1).toBe(1);
    expect(smokeDoc!.indexOf(fourth)).toBeGreaterThan(smokeDoc!.indexOf(RULE_CASE_3));
    expect(smokeDoc!.indexOf(fourth)).toBeLessThan(smokeDoc!.indexOf(CARVE_OUT));
    // …and it does NOT narrow the carve-out, which it states explicitly.
    expect(smokeDoc!).toContain("**This does not narrow the carve-out");
  });

  test("the fourth state's two hidden premises are asserted, not assumed", () => {
    // SURFACED BY THE AUDIT, which verified both and noted neither was pinned.
    // "no log ⇒ the sampler never ran" is true only if (a) the log cannot
    // survive from a previous run, and (b) at least one poll call always
    // happens. If either stops holding, the new state FAILs healthy runs — the
    // false-RED outcome AC.2 exists to prevent, arriving through a premise
    // rather than through the rule.
    //
    // (a) the sample log is inside Phase 0.5's verified wipe glob.
    const wipeGlob = "/tmp/dpt-smoke-<tracker>-*";
    expect(smokeDoc!).toContain(wipeGlob.slice(0, wipeGlob.length - 1));
    const logPath = "/tmp/dpt-smoke-<tracker>-ste451-lock-samples.log";
    expect(logPath.startsWith(wipeGlob.slice(0, -1))).toBe(true);
    // (b) the sampler is wired to the poll CALL, which the chain always makes
    // at least once after a spawn — so a healthy run always writes a log.
    expect(smokeDoc!).toMatch(/Run § Fixture group 10's sampler once per poll call/);
    expect(smokeDoc!).toMatch(/run the sampler below \*\*once per step-3 poll call\*\*/i);
  });

  test("the fourth state's OUTCOME is pinned, not just its heading", () => {
    // FOUND BY MUTATION, and it was green: replacing "Report it as
    // `10a-sampler-absent` and **FAIL 10a**" with "Note it as
    // `10a-sampler-absent`" reddened NOTHING. The state was declared and its
    // consequence was not — a fourth state that renders no verdict is a fourth
    // WORD, and the group would have gone on tolerating a driver that never
    // sampled.
    //
    // This is `specs/plan/M121.md` § Milestone finding, verbatim: "Pinning the
    // SUMMARY of a mechanism is not pinning the mechanism." I made that error
    // in the FR whose thesis is that such assertions are the defect, and only
    // the mutation battery found it — the suite was 196/0 with the hole open.
    expect(smokeDoc!).toContain(
      "Report it as `10a-sampler-absent` and **FAIL 10a**",
    );
    // The reasoning that makes the outcome correct rather than arbitrary: the
    // driver's own step-3 wire already says skipping the sampler fails 10a, so
    // this is a consistency requirement between two surfaces, not a new rule.
    expect(smokeDoc!).toContain(
      "§ Phase 2 step 3 already says skipping it fails this sub-fixture",
    );
    expect(smokeDoc!).toContain(
      "Skipping it does not fail this step — it fails sub-fixture 10a",
    );
  });
});

// ═════════════════════════════ AC-STE-456.3 ══════════════════════════════════

describeIfSkills("AC-STE-456.3 — the witness is captured during the chain", () => {
  test("EXECUTED: the claim commit lands in the durable log at sample time", async () => {
    const f = buildFixture();
    try {
      await claim(f);
      const expected = git(f.root, "log", "--format=%H", "-1");
      sample(f);
      expect(logLines(f)).toContain(`claim-commit ${expected}`);
    } finally {
      cleanup(f);
    }
  });

  test("EXECUTED: the witness SURVIVES the release that deletes the lock", async () => {
    // The property the whole capture-early design rests on: after step 3 exits,
    // the file is gone and the evidence is not. A leg killed here keeps it.
    const f = buildFixture();
    try {
      await claim(f);
      sample(f); // mid-run sample: lock present
      release(f);
      sample(f); // post-release sample: lock gone, witness still readable
      const lines = logLines(f)!;
      expect(lines[0]).toBe(`lock-present ${f.frId}`);
      expect(lines[2]).toBe(`lock-absent ${f.frId}`);
      expect(lines[1]).toMatch(/^claim-commit [0-9a-f]{40}$/);
      expect(lines[3]).toBe(lines[1]); // the same commit, after the file died
    } finally {
      cleanup(f);
    }
  });

  test("the capture is wired into step 3, and the VERDICT did not move", () => {
    // AC.3's second half, which is as load-bearing as the first: moving the
    // rendering would change what the fixture phase is for. Only the moment of
    // capture moves.
    const step3 = smokeDoc!.slice(
      smokeDoc!.indexOf("Tracker-less leg only — sample the lock"),
    ).slice(0, 1400);
    expect(step3).toContain("two-sided");
    expect(step3).toContain("before this step exits");
    const sampler = group10Fences()[1]!;
    expect(sampler).toContain("Rendering does NOT move — Phase 2.X still decides.");

    // THE "UNMOVED" HALF, MADE FALSIFIABLE — corrected after the audit.
    //
    // This was a document-wide `toContain("STE-382 runtime check: PASS")`,
    // which is LOCATION-BLIND: the audit relocated that emission out of the
    // group 10 block into the step-3 paragraph and ZERO STE-456 assertions
    // fired. Asserting a sentence exists is not asserting it did not move, and
    // "unmoved" is the entire second clause of AC.3.
    //
    // Bound to position instead: the emission must live inside the group 10
    // block, and the block is located by its own heading rather than by a
    // character window.
    const EMIT = "append `STE-382 runtime check: PASS` to the run summary line";
    expect(smokeDoc!.split(EMIT)).toHaveLength(2); // exactly one emission site
    const blockStart = smokeDoc!.indexOf("#### Fixture group 10 — STE-382");
    const blockEnd = smokeDoc!.indexOf("\n### Phase 2.Y", blockStart);
    expect(blockStart).toBeGreaterThan(0);
    expect(blockEnd).toBeGreaterThan(blockStart);
    const emitAt = smokeDoc!.indexOf(EMIT);
    expect({ insideTheFixturePhase: emitAt > blockStart && emitAt < blockEnd }).toEqual({
      insideTheFixturePhase: true,
    });
    // …and it is NOT in the chain step, which is where "moving the verdict
    // earlier" would put it.
    const step3At = smokeDoc!.indexOf("Tracker-less leg only — sample the lock");
    expect(step3At).toBeLessThan(blockStart);
    expect(emitAt).toBeGreaterThan(step3At);
  });

  test("EXECUTED: the witness fences pin their regex FLAVOUR, not the operator's config", () => {
    // FOUND BY THE ADVERSARIAL PASS, and it is a false-RED risk rather than a
    // vacuity: `git log --grep` honours `grep.patternType` / `grep.extendedRegexp`.
    // Under ERE or PCRE the literal `(locks)` becomes a CAPTURE GROUP, so the
    // pattern means `chorelocks` and can never match a real claim subject.
    //
    // Before STE-456 that produced an empty sample log with the claim commit
    // present — a `10a-sampling-gap`, tolerated. Now that the witness is
    // REQUIRED by the Phase 4 row, the same config would turn a perfectly
    // healthy run into a hard FAIL. A fixture that false-REDs on a healthy run
    // gets disabled within two releases, which is the outcome AC.2 is written
    // to prevent — so this is squarely in scope.
    for (const fence of [group10Fences()[1]!, group10Fences()[2]!]) {
      expect(fence).toContain("--basic-regexp");
    }
    const f = buildFixture();
    try {
      return claim(f).then(() => {
        const fences = group10Fences();
        // Run the shipped fence under a hostile config. `-c` on the outer git
        // does not reach the fence, so the config is set in the environment the
        // fence's own `git` reads.
        const hostile = `export GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=grep.patternType GIT_CONFIG_VALUE_0=extended\n${aim(fences[0]!, f)}\n${fences[2]!}`;
        expect(runBash(hostile).out).toContain(`ulid: ${f.frId}`);
      }).finally(() => cleanup(f));
    } catch (e) {
      cleanup(f);
      throw e;
    }
  });
});

// ═════════════════════════════ AC-STE-456.4 ══════════════════════════════════

type RowVerdict = { pass: boolean; reason: string };

/**
 * ANALOGUE (labelled — see the file header). § Phase 4's release-proof row as a
 * predicate over the artifacts the extracted fences leave behind.
 */
function releaseProofRow(f: Fixture): RowVerdict {
  const absent = !existsSync(join(locksDir(f.root), f.frId));
  const lines = logLines(f);
  if (lines === null) {
    return { pass: false, reason: "no sample log — the sampler never ran" };
  }
  const witnesses = lines
    .filter((l) => l.startsWith("claim-commit "))
    .map((l) => l.slice("claim-commit ".length))
    .filter((s) => s !== "none");
  if (witnesses.length === 0) {
    return { pass: false, reason: "claim-commit none — no claim was ever made" };
  }
  if (!absent) return { pass: false, reason: "the lock survived the run" };
  return { pass: true, reason: "witness present and the lock is gone" };
}

/** The PRE-456 row: absence alone. Kept so the change can be measured. */
function releaseProofRowPre456(f: Fixture): RowVerdict {
  const absent = !existsSync(join(locksDir(f.root), f.frId));
  return {
    pass: absent,
    reason: absent ? "the lock is absent" : "the lock survived the run",
  };
}

describeIfSkills("AC-STE-456.4 — the release proof requires the witness", () => {
  test("PROSE: the row demands the durable witness AND the absence", () => {
    const row = ac9Window(smokeDoc!);
    expect(row).toContain("The durable claim witness is REQUIRED here");
    expect(row).toContain("`claim-commit none`, or no such line at all, is a **FAIL even with the lock absent**");
  });

  test("PROSE: the row's TITLE says so too — it cannot revert to half-only", () => {
    // FOUND BY MUTATION, and it was green: reverting the title to "the release
    // proof, and exactly half of it." reddened NOTHING across six suites. The
    // row would then have carried a heading contradicting its own operative
    // paragraph, with the gate clean — the documentation twin of a test that
    // passes for the wrong reason.
    //
    // Pinned as a SLICE of the row rather than as a document-wide token,
    // because the predecessor half of the title ("the release proof") is the
    // anchor guard's own subject and must stay exactly where it is.
    const row = ac9Window(smokeDoc!);
    expect(row.slice(0, 200)).toContain(
      "the release proof: the durable claim witness AND the absence.",
    );
    // …and the retired phrasing is gone from the whole document, so it cannot
    // come back somewhere the slice does not look.
    expect(smokeDoc!).not.toContain("the release proof, and exactly half of it");
  });

  test("PROSE: the superseded half-assertion paragraph is RETAINED, not deleted", () => {
    // Pattern 31's house remedy, applied rather than quoted: the paragraph
    // STE-448 wrote is still true as a diagnosis and its pins are shipped
    // guards. It is annotated as history, never weakened away.
    const row = ac9Row(smokeDoc!);
    expect(row).toContain("deliberately only HALF of the lock assertion");
    expect(row).toContain("**SUPERSEDED IN PART BY STE-456, and retained verbatim rather than rewritten.**");
    expect(row.indexOf("deliberately only HALF")).toBeLessThan(
      row.indexOf("SUPERSEDED IN PART BY STE-456"),
    );
  });

  test("EXECUTED: the vacuous green is gone — and the OLD row still produces it", () => {
    // THE CORE MEASUREMENT OF AC.4, and it is deliberately two-directional.
    // A one-directional "the new row fails" proves nothing about whether the
    // change bit: a row that fails everything satisfies it too. The old row
    // must be shown PASSING on the same disk.
    const f = buildFixture();
    try {
      sample(f); // a real sample against a project that never claimed
      expect(releaseProofRowPre456(f)).toEqual({
        pass: true,
        reason: "the lock is absent",
      });
      expect(releaseProofRow(f)).toEqual({
        pass: false,
        reason: "claim-commit none — no claim was ever made",
      });
    } finally {
      cleanup(f);
    }
  });

  test("EXECUTED: a healthy claimed-then-released run still passes BOTH forms", async () => {
    // The regression floor. Closing a vacuous green by reddening healthy runs
    // is not a fix, and this milestone has a standing rule about false REDs
    // getting fixtures disabled.
    const f = buildFixture();
    try {
      await claim(f);
      sample(f);
      release(f);
      expect(releaseProofRowPre456(f).pass).toBe(true);
      expect(releaseProofRow(f)).toEqual({
        pass: true,
        reason: "witness present and the lock is gone",
      });
    } finally {
      cleanup(f);
    }
  });

  test("EXECUTED: a lock that survives the run still fails, as it always did", async () => {
    const f = buildFixture();
    try {
      await claim(f);
      sample(f);
      expect(releaseProofRow(f)).toEqual({
        pass: false,
        reason: "the lock survived the run",
      });
      expect(releaseProofRowPre456(f).pass).toBe(false);
    } finally {
      cleanup(f);
    }
  });

  test("EXECUTED: a forfeited fixture phase no longer forfeits the evidence", async () => {
    // The 2026-08-08 shape, reproduced: the chain completes, the sampler has
    // run, and everything downstream is killed. The durable log is what the
    // next reader has. Assert it is sufficient to decide the row.
    const f = buildFixture();
    try {
      await claim(f);
      sample(f);
      release(f);
      // Phase 2.X, 2.Y, 3 and 4 never run. The artifacts are all that survive.
      const lines = logLines(f)!;
      expect(lines.some((l) => l.startsWith("claim-commit ") && l !== "claim-commit none")).toBe(true);
      expect(releaseProofRow(f).pass).toBe(true);
    } finally {
      cleanup(f);
    }
  });
});

// ═════════════════════════════ AC-STE-456.5 ══════════════════════════════════

/** must-fire: every phrasing a drifting presence claim actually takes. */
const MUST_FIRE: ReadonlyArray<[string, string]> = [
  ["bare: assert", "assert the lock exists before the archive"],
  ["bare: verify", "also verify the lock file was created mid-run"],
  ["bare: check", "check that .dpt/locks/<id> is present after the claim step"],
  ["bare: confirm", "confirm the lock existed at claim time"],
  ["bare: pin", "pin that the lock file is present mid-run"],
  ["inflected: asserts", "The run also asserts the lock exists mid-run"],
  ["inflected: verifies", "the driver verifies the lock file is present"],
  ["inflected: confirms", "this row confirms the lock existed"],
  ["inflected: pinned", "a pinned assertion that the lock was created"],
  ["inflected: checking", "checking that the lock exists at claim time"],
  ["inflected: asserted", "it is asserted that the lock file is present"],
  ["inflected: verifying", "verifying the lock exists mid-run"],
];

/** must-be-silent: correct prose, and the git-history witness AC.4 requires. */
const MUST_BE_SILENT: ReadonlyArray<[string, string]> = [
  ["the row's own absence wording", "`.dpt/locks/<id>` is ABSENT after the archive commit"],
  [
    "the git-history witness (AC.4's own sentence)",
    "confirm the claim commit that created the lock exists in the test project's history",
  ],
  ["the log-reading instruction", "Read the `claim-commit <sha|none>` line from the sample log"],
  ["a witness stated as a commit property", "assert the claim commit for the lock exists"],
  ["no lock object at all", "verify the ticket exists in the tracker"],
];

/**
 * THE NAMED RESIDUAL HOLE. Not smoothed over, not quietly tolerated.
 *
 * The `commit` exclusion cannot tell a sentence that names the commit as its
 * SUBJECT (legitimate) from one that names it in a subordinate clause while
 * making a filesystem-presence claim (drift). This is the second class, and it
 * goes silent. It is asserted below so that a future narrowing which closes it
 * is FORCED to update this note rather than leave it stale — the milestone's
 * standing complaint about measurements that rot silently.
 */
const RESIDUAL_HOLE =
  "verify that, before the archive commit, the lock file exists mid-run";

describeIfSkills("AC-STE-456.5 — the tripwire narrowing, measured in both directions", () => {
  test("the shipped tripwire scores the whole labelled corpus", () => {
    const rows = [
      ...MUST_FIRE.map(([label, s]) => ({
        label,
        expected: true,
        actual: PRESENCE_CLAIM_TRIPWIRE.test(s),
      })),
      ...MUST_BE_SILENT.map(([label, s]) => ({
        label,
        expected: false,
        actual: PRESENCE_CLAIM_TRIPWIRE.test(s),
      })),
    ];
    expect(rows.filter((r) => r.expected !== r.actual)).toEqual([]);
  });

  test("the WIDENING bit — inflections the predecessor form could not see", () => {
    // Pattern 31's rider: run the mutation against the form being REPLACED.
    // A case both forms catch proves nothing about which is doing the work.
    const gained = MUST_FIRE.filter(
      ([, s]) =>
        PRESENCE_CLAIM_TRIPWIRE.test(s) && !PRESENCE_CLAIM_TRIPWIRE_PRE_456.test(s),
    ).map(([label]) => label);
    expect(gained).toEqual([
      "inflected: asserts",
      "inflected: verifies",
      "inflected: confirms",
      "inflected: pinned",
      "inflected: checking",
      "inflected: asserted",
      "inflected: verifying",
    ]);
    // …and nothing the predecessor caught was lost.
    const lost = MUST_FIRE.filter(
      ([, s]) =>
        PRESENCE_CLAIM_TRIPWIRE_PRE_456.test(s) && !PRESENCE_CLAIM_TRIPWIRE.test(s),
    ).map(([label]) => label);
    expect(lost).toEqual([]);
  });

  test("the NARROWING bit — the git-history witness was banned before and is permitted now", () => {
    // The other direction, and the reason the narrowing exists at all. AC.4
    // requires the row to demand the claim COMMIT; the predecessor tripwire
    // banned the natural English for it, so without this the row could not
    // state its own requirement.
    const witness = MUST_BE_SILENT[1]![1];
    expect({
      pre456: PRESENCE_CLAIM_TRIPWIRE_PRE_456.test(witness),
      shipped: PRESENCE_CLAIM_TRIPWIRE.test(witness),
    }).toEqual({ pre456: true, shipped: false });
  });

  test("the NAMED residual hole is exactly where the note says it is", () => {
    expect(PRESENCE_CLAIM_TRIPWIRE.test(RESIDUAL_HOLE)).toBe(false);
    // The predecessor caught it, so this is a real cost of the narrowing and
    // is recorded as one rather than presented as a pure improvement.
    expect(PRESENCE_CLAIM_TRIPWIRE_PRE_456.test(RESIDUAL_HOLE)).toBe(true);
    expect(readFileSync(join(import.meta.dir, "_ac9-row-guard.ts"), "utf8")).toContain(
      RESIDUAL_HOLE,
    );
  });

  test("the row's shipped text is silent under the tripwire — over the WHOLE row", () => {
    // The 2400-character window no longer reaches the row's end (see AC.6), so
    // a ban scoped to it would stop covering the row's own tail. This scans the
    // row, which is strictly larger. The shipped window-scoped assertions in
    // the AC-STE-448.9 suite are left byte-unchanged beside it.
    expect(ac9Row(smokeDoc!)).not.toMatch(PRESENCE_CLAIM_TRIPWIRE);
  });

  test("the row-bounded ban is not blind — it fires on injected drift", () => {
    const injected = `${ac9Row(smokeDoc!)}\n\n  Also assert the lock file exists mid-run.`;
    expect(injected).toMatch(PRESENCE_CLAIM_TRIPWIRE);
    // …and the drift lands OUTSIDE the historical window, which is the whole
    // reason the row-bounded ban was added. Measured, not assumed.
    expect(ac9Row(smokeDoc!).length).toBeGreaterThan(AC9_WINDOW);
  });
});

// ═════════════════════════════ AC-STE-456.6 ══════════════════════════════════

/**
 * The budget predicate itself — ONE definition, used by the live assertion and
 * by its own mutation witness.
 *
 * A pin can leave the window two ways and they look different in the output:
 * it can fall out entirely (`indexOf` → -1) or it can START inside and END
 * outside, which is the silent one — `indexOf` finds it, the guard then reads a
 * truncated subject, and nothing anywhere reports that it happened.
 */
function budgetViolations(
  doc: string,
): Array<{ phrase: string; at: number; endsAt: number }> {
  const win = ac9Window(doc);
  return AC9_DISCLAIMER_PINS.map((phrase) => {
    const at = win.indexOf(phrase);
    return { phrase, at, endsAt: at === -1 ? -1 : at + phrase.length };
  }).filter((r) => r.at === -1 || r.endsAt > AC9_WINDOW);
}

describeIfSkills("AC-STE-456.6 — the guarded-window budget", () => {
  test("every disclaimer pin sits inside the 2400-character slice", () => {
    expect(budgetViolations(smokeDoc!)).toEqual([]);
  });

  test("the budget REPORTS its headroom, so an overrun is a number not a surprise", () => {
    const win = ac9Window(smokeDoc!);
    const furthest = Math.max(
      ...AC9_DISCLAIMER_PINS.map((p) => win.indexOf(p) + p.length),
    );
    const headroom = AC9_WINDOW - furthest;
    // Measured: 94 characters, the last pin ending at 2306.
    //
    // THE FIRST RECORDED NUMBER WAS 132 AND IT WAS WRONG — the pin list held
    // truncated STEMS of two guarded phrases, so the budget was computed for a
    // shorter subject than the shipped guards actually match. A budget whose
    // pin list is not the guard list is a budget for a different document, and
    // it reported 33 characters of headroom that did not exist. Corrected after
    // the audit; the stems are now the full subjects.
    //
    // The assertion is not the number — it is that the number is POSITIVE, and
    // that growing the row past it goes RED instead of silently un-guarding a
    // pin. The row itself is already ~1.4k characters longer than the window,
    // which is why the tripwire is additionally scanned over the WHOLE row.
    expect({ headroomIsPositive: headroom > 0 }).toEqual({ headroomIsPositive: true });
    expect(furthest).toBeLessThanOrEqual(AC9_WINDOW);
  });

  test("the budget BITES — prose grown before the last pin turns it RED", () => {
    // NON-VACUITY, executed in memory against the SAME predicate the live
    // assertion uses. Without this the budget is a sum that has never been seen
    // to exceed anything — and this milestone has shipped `VERIFY: OK` printed
    // over an empty set.
    const win = ac9Window(smokeDoc!);
    const furthest = Math.max(
      ...AC9_DISCLAIMER_PINS.map((p) => win.indexOf(p) + p.length),
    );
    const headroom = AC9_WINDOW - furthest;
    const anchor = "The durable claim witness is REQUIRED here";
    const bloated = smokeDoc!.replace(anchor, `${"x".repeat(headroom + 1)}${anchor}`);
    expect(bloated.length).toBe(smokeDoc!.length + headroom + 1); // applied

    const violations = budgetViolations(bloated);
    // Exactly the trailing pin is pushed out — not "something failed", but the
    // specific pin the headroom was measured against.
    expect(violations.map((v) => v.phrase)).toEqual([
      "satisfied *vacuously* by a lock that was never created",
    ]);
    // …and one character LESS is still inside, which is what proves the number
    // is the real boundary rather than an over-large mutation reddening
    // everything it touches.
    expect(
      budgetViolations(smokeDoc!.replace(anchor, `${"x".repeat(headroom)}${anchor}`)),
    ).toEqual([]);
  });

  test("the anchor is UNIQUE — a second occurrence relocates the whole guard", () => {
    // follow-ups § 0i, converted from a warning into an assertion. § 0i's own
    // remedy ("assert the slice contains its subject") detects a relocation
    // only once it has already gone far enough to lose the subject. Counting
    // the anchor detects the second occurrence itself, wherever it lands.
    expect(() => assertAnchorUnique(smokeDoc!)).not.toThrow();
    expect(() =>
      assertAnchorUnique(`A stray mention of AC-STE-448.9.\n${smokeDoc!}`),
    ).toThrow(/exactly once/);
  });
});

// ═════════════════════════════ AC-STE-456.7 ══════════════════════════════════

describeIfSkills("AC-STE-456.7 — the commit-witness fence, executed for real", () => {
  test("EXECUTED: the fence matches a subject written by the real claimLock", async () => {
    // NOTHING IN THIS REPOSITORY HAD EVER RUN THIS PATTERN AGAINST A REAL
    // CLAIM COMMIT. The fence greps `^chore(locks): claim lock for <id> ` with
    // a TRAILING SPACE; the real subject is `… for <id> on <branch>`. By
    // inspection it matches. Inspection is what this test replaces.
    const f = buildFixture();
    try {
      await claim(f);
      const subject = git(f.root, "log", "--format=%s", "-1");
      expect(subject).toBe(`chore(locks): claim lock for ${f.frId} on ${f.branch}`);
      const fences = group10Fences();
      const r = runBash(`${aim(fences[0]!, f)}\n${fences[2]!}`);
      expect(r.out).toContain(`ulid: ${f.frId}`);
    } finally {
      cleanup(f);
    }
  });

  test("EXECUTED: a ONE-BYTE reworded subject fails the fence", async () => {
    // The discriminating negative. `git log --grep` uses POSIX BASIC regex, so
    // `(` is literal and the parentheses are fine — but that is a claim about
    // the pattern, and a pattern that matched everything would satisfy the
    // positive above just as well.
    const f = buildFixture();
    try {
      await claim(f);
      const original = git(f.root, "log", "--format=%s", "-1");
      const reworded = original.replace("claim lock", "claim Lock"); // one byte
      expect(reworded).not.toBe(original);
      expect(reworded.length).toBe(original.length);
      git(f.root, "commit", "--quiet", "--amend", "-m", reworded);
      expect(git(f.root, "log", "--format=%s", "-1")).toBe(reworded); // applied

      const fences = group10Fences();
      const r = runBash(`${aim(fences[0]!, f)}\n${fences[2]!}`);
      expect(r.out).not.toContain(`ulid: ${f.frId}`);
      expect(r.out.trim()).toBe("");
    } finally {
      cleanup(f);
    }
  });

  test("EXECUTED: the step-3 capture agrees with the post-step-3 fence", async () => {
    // Two implementations of "the claim commit" that disagree is the defect,
    // whichever is right — STE-451's correction #37, applied to the pair this
    // FR creates. The sampler's `--grep` and 10b's `--grep` must resolve the
    // same commit.
    const f = buildFixture();
    try {
      await claim(f);
      sample(f);
      const captured = logLines(f)!
        .find((l) => l.startsWith("claim-commit "))!
        .slice("claim-commit ".length);
      // USES 10b's OWN `SHA`, not a hand-copied `--grep` — corrected after the
      // audit. The first draft recomputed the witness with its own copy of the
      // pattern, so a drift in the shipped 10b grep reddened other tests but
      // NOT the one whose stated subject is that the two greps agree. That is
      // correction #52's duplicated-literal shape, in the test written to
      // compare two definitions. `SHA` is already bound by fence[2] in this
      // same shell; echoing it is the whole comparison.
      const fences = group10Fences();
      const r = runBash(`${aim(fences[0]!, f)}\n${fences[2]!}\necho "SHA=\${SHA}"`);
      expect(captured).toMatch(/^[0-9a-f]{40}$/);
      expect(r.out).toContain(`SHA=${captured}`);
    } finally {
      cleanup(f);
    }
  });
});

// ═════════════════════════════ AC-STE-456.8 ══════════════════════════════════
//
// FALSIFIABILITY AGAINST THE LIVE DEFECT.
//
// The hazard this section is built around, and it is the one a passing result
// hides best: a FAIL that comes from something INCIDENTAL — an unresolvable
// identity, a missing log directory, a fence aimed at the wrong tree — is
// indistinguishable in the output from a FAIL produced by the predicate under
// test. A detector proved only against a project broken in several ways at once
// has not been proved against this defect.
//
// The defence is the shape of the whole section: make the PASSING case work
// first, then remove EXACTLY ONE thing — the claim — and confirm the failure
// MOVES. Every incidental is asserted healthy on both sides.

describeIfSkills("AC-STE-456.8 — RED against the live defect, before the fix", () => {
  test("EXECUTED: the passing case works FIRST — claimed, sampled, released", async () => {
    const f = buildFixture();
    try {
      await claim(f);
      const r = sample(f);
      release(f);

      // Every incidental asserted healthy, so a later FAIL cannot be blamed on
      // one of them.
      expect(r.err).toBe("");
      expect(r.code).toBe(0);
      expect(logLines(f)).toHaveLength(2);
      expect(logLines(f)![0]).toBe(`lock-present ${f.frId}`);

      expect(releaseProofRow(f)).toEqual({
        pass: true,
        reason: "witness present and the lock is gone",
      });
    } finally {
      cleanup(f);
    }
  });

  test("EXECUTED: remove EXACTLY ONE thing — the claim — and the failure MOVES", () => {
    // THE LIVE DEFECT, staged as the 2026-08-08 leg left it: an FR carrying a
    // well-formed minted id, a healthy git history, no `.dpt/locks/` directory
    // and no claim commit. Identical to the passing case in every respect
    // except that `claimLock` was never called.
    const f = buildFixture();
    try {
      const r = sample(f);

      // The SAME incidentals, asserted healthy on this side too. This is what
      // makes the FAIL below attributable.
      expect(r.err).toBe("");
      expect(r.code).toBe(0);
      expect(logLines(f)).toHaveLength(2);
      expect(existsSync(locksDir(f.root))).toBe(false);
      expect(git(f.root, "log", "--format=%s").split("\n")).toEqual([
        "chore: seed the tracker-less fixture",
      ]);

      // …and the failure lands on the witness, naming it.
      expect(releaseProofRow(f)).toEqual({
        pass: false,
        reason: "claim-commit none — no claim was ever made",
      });
    } finally {
      cleanup(f);
    }
  });

  test("EXECUTED: on that same disk the PRE-456 row reports GREEN", () => {
    // The finding, reproduced as an executable fact rather than a citation:
    // "AC-STE-448.9's absence row scores GREEN for exactly the wrong reason".
    // This is what the detection is FOR, and it is the only assertion here that
    // could not be written once STE-457 lands.
    const f = buildFixture();
    try {
      sample(f);
      expect(releaseProofRowPre456(f)).toEqual({
        pass: true,
        reason: "the lock is absent",
      });
      expect(releaseProofRow(f).pass).toBe(false);
    } finally {
      cleanup(f);
    }
  });

  test("EXECUTED: the group-10 fences ALSO fail on the live-defect disk", async () => {
    // The detection is not only the Phase 4 row. 10b's fence must find nothing
    // where a claim never happened, and must find the blob where it did — run
    // as a pair so that "the fence printed nothing" is not satisfied by a fence
    // that prints nothing ever.
    const broken = buildFixture();
    const healthy = buildFixture();
    try {
      await claim(healthy);
      const fences = group10Fences();
      const brokenOut = runBash(`${aim(fences[0]!, broken)}\n${fences[2]!}`).out;
      const healthyOut = runBash(`${aim(fences[0]!, healthy)}\n${fences[2]!}`).out;
      expect({
        broken: brokenOut.includes(`ulid: ${broken.frId}`),
        healthy: healthyOut.includes(`ulid: ${healthy.frId}`),
      }).toEqual({ broken: false, healthy: true });
    } finally {
      cleanup(broken);
      cleanup(healthy);
    }
  });

  test("the ordering arrow is intact — STE-457's fix has NOT landed", () => {
    // AC.8's precondition, asserted rather than assumed. The live defect is
    // this FR's non-renewable test input: `/implement` step 0.c's mode-none
    // half still names no module path and no call form, so a tracker-less run
    // still has nothing followable to follow and still writes no lock.
    //
    // WHEN THIS GOES RED IT IS NOT A REGRESSION. It means STE-457 has landed,
    // and the correct response is to retire this assertion and record that
    // every subsequent proof of this detector is against a reconstruction.
    // RESOLVED BY NAME, NOT BY POSITION — corrected after the audit, and the
    // first draft was the defect this branch's own commit `6fd67ca` corrected
    // one FR earlier ("resolve by name, not position").
    //
    // It selected the bullet with `.find(l => l.includes("claimLock") &&
    // l.includes("mode: none"))`. TWO lines match: § 0.b Provider resolution
    // (which names `LocalProvider` and `mode: none` in its resolution rule) and
    // § 0.c Claim, the actual subject. `find` returns 0.b. MUTATION-PROVED in
    // both directions: applying the real STE-457 fix to 0.c left the suite
    // GREEN, and adding the same module path to 0.b turned it RED.
    //
    // So the one assertion whose documented job is to announce "STE-457 has
    // landed, this detector is no longer proved against a live defect" could
    // not fire on that event. AC-STE-457.1 confirms the aim: the fix lands on
    // § 0.c precisely.
    const implement = read(join(PLUGIN_ROOT, "skills/implement/SKILL.md"));
    expect(implement).not.toBeNull();
    const lines = implement!.split("\n");
    const matches = lines.filter((l) => l.includes("**0.c Claim**"));
    expect(matches).toHaveLength(1); // the selector is unambiguous
    const bullet = matches[0]!;
    // The bullet is the one the FR names, proved by its own content.
    expect(bullet).toContain("`LocalProvider.claimLock` writes `.dpt/locks/<id>`");
    // …and it still names no module path — the defect is still live.
    expect(bullet).not.toContain("adapters/_shared/src/local_provider");
  });
});

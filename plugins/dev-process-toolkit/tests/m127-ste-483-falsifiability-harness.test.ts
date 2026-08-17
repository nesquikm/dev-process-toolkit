// M127 STE-483 — falsifiability harness for the six assertion repairs, with
// halt-on-vacuous.
//
// WHAT THIS FR BUILDS, and why the tests below are shaped the way they are.
//
// M127 repairs six assertions in `.claude/skills/smoke-test/SKILL.md`
// (STE-484 … STE-489). Every one of them has been passing or failing for the
// wrong reason, so "the repaired assertion now reads green" proves nothing on
// its own. The only evidence worth anything is: take the subject away and
// watch the assertion go red. This FR builds that machinery once — BEFORE any
// of the six repairs land — and records a literal outcome token in
// `specs/plan/M127.md` that HALTS the milestone if the machinery turns out to
// be vacuous itself.
//
// THREE METHOD CONSTRAINTS ARE THE POINT OF THE FR, and each is pinned hard:
//
//  1. EXTRACT-AND-EXECUTE (AC.1). The harness reads the assertion's shell form
//     OUT OF the SKILL and runs those bytes. It must not carry its own
//     paraphrase — a harness holding a private copy would keep reporting green
//     after the SKILL drifted away from it, which is the STE-456 AC.7 /
//     STE-461 AC.12 method's whole reason for existing. Pinned two ways: the
//     extracted shell must be a verbatim substring of the real SKILL, and a
//     one-token rewording of that same span in the SKILL must make extraction
//     FAIL rather than fall back to a remembered form.
//
//  2. MUTATE-THE-SUBJECT (AC.3, the STE-461 AC.13 erratum). A perfect pin on
//     the wrong subject is worthless. So a mutation that merely rewords nearby
//     text is not evidence and the harness must REFUSE it, not score it. Three
//     mutation classes are distinguished: `subject-removed` (the only one that
//     counts), `rewording-only`, and `not-applied`.
//
//  3. MARKER COUNT, NOT PRESENCE (AC.6, the M124 lesson). A mutation that
//     silently never applied leaves the suite green and reads as a pass. Every
//     comparison here is over counts, and the "mutation did not apply" case is
//     tested explicitly rather than assumed away.
//
// WHY THE REAL-FILE HALF IS KEYED ON FIXTURE GROUP 6. The extraction tests run
// against the live `.claude/skills/smoke-test/SKILL.md`, but they must not be
// keyed on bytes that STE-484 … STE-489 are about to rewrite — a test that
// breaks the moment the repairs land is not a harness, it is a tripwire. Group
// 6 (STE-230 spec-research runtime) is untouched by this milestone and carries
// a single unambiguous shell span, so it is the stable real-file subject. The
// section-slicer's edge cases run against synthetic bodies, where the bytes are
// under this test's own control.
//
// THE FIXTURES ARE REDUCED SLICES OF REAL 2026-08-16 CAPTURES (AC.5). The three
// source captures (`/tmp/dpt-smoke-{linear,jira,none}-implement.log`, 470 KB –
// 1,002 KB) are run artifacts and are not committable. What ships under
// `tests/fixtures/m127-falsifiability/` is a derived slice per leg: only events
// carrying the ```tdd-result subject survive, plus the `init` and `result`
// events so the slice is still a well-formed capture, and long strings inside
// kept events are reduced to ±220-char windows around each occurrence. Subject
// occurrence COUNTS are preserved byte-exactly, and all three of the run's
// measured facts survive the reduction: the line-anchored grep scores 0,
// `extractAssistantText` scores 0 anchored fences, and the forked `tool_result`
// projection scores linear 8 / jira 6 / none 6.
//
// THE SHAPE THE IMPLEMENTER MUST BUILD — a new module,
// `adapters/_shared/src/falsifiability_harness.ts`, exporting:
//
//   SMOKE_SKILL_RELATIVE_PATH: string
//     ".claude/skills/smoke-test/SKILL.md", repo-root-relative.
//
//   FALSIFIABILITY_FIXTURE_DIR: string
//     Absolute path to `tests/fixtures/m127-falsifiability/`. Never /tmp — the
//     harness re-runs offline, without a live conformance leg (AC.5).
//
//   capturePathFor(leg: "linear" | "jira" | "none"): string
//     The shipped present-subject capture for that leg, inside the dir above.
//
//   M127_REPAIR_ROSTER: readonly string[]
//     The six FR ids M127 repairs, in plan order.
//
//   M127_REPAIRS: readonly RepairEntry[]
//     The registry. Starts empty and grows as each repair lands. An entry
//     carries `{ id, site, subject, leg, threshold }` — a SITE to extract from,
//     never a `shell` of its own (that would be the paraphrase AC.1 forbids).
//
//   uncoveredRepairs(registry, roster): readonly string[]
//     Roster ids with no registry entry, in roster order. Throws when the
//     registry carries an id the roster does not know, or a duplicate id.
//
//   extractAssertionShell(skillBody, site): { shell, line }
//     Slices the section whose heading contains `site.section` (ending at the
//     next heading of the same or shallower depth), scans the inline code spans
//     inside it (double-backtick spans as well as single), and returns the one
//     whose body contains `site.select`. Throws when zero match and when more
//     than one matches — an ambiguous site is an undetermined subject.
//
//   bindCapture(shell, capturePath): { command, capturePath }
//     Substitutes the `/tmp/dpt-smoke-…​.log` capture-path token in the
//     extracted bytes with `capturePath`. Exactly one such token must occur.
//     Everything else in the command stays byte-identical to the SKILL's form.
//
//   runAssertion(bound): { command, exitCode, stdout, count }
//     Executes the bound command through bash. Non-zero exit is data, not an
//     error (`grep -c` exits 1 on zero matches). `count` is the integer on
//     stdout when stdout is exactly one integer, else the number of non-empty
//     stdout lines.
//
//   removeSubject(capture, subject): { text, removed }
//     Deletes every occurrence of `subject`. Throws when `removed` is 0 — a
//     mutation that did not apply must never reach a verdict (AC.6).
//
//   classifyMutation(original, mutated, subject): MutationClass
//     "not-applied" when the bytes are unchanged, "subject-removed" when the
//     subject's occurrence count fell to 0, "rewording-only" when the bytes
//     changed but the subject count did not.
//
//   checkFalsifiability({ id, shell, capturePath, subject, threshold, mutate? })
//     Runs the bound command against the present capture and against the
//     mutated one, and returns { id, command, presentCount, absentCount,
//     removed, verdict }. Throws unless the mutation classifies as
//     `subject-removed`. `verdict` is "falsifiable" only when presentCount >=
//     threshold AND absentCount < threshold — either half missing is "vacuous"
//     (AC.2). Must not modify the shipped fixture on disk.
//
//   HARNESS_OUTCOME_TOKENS / harnessOutcomeFor(results) / readHarnessOutcome(planBody)
//     The two literal tokens, the verdict over a result set (throws on an empty
//     set — zero results is not evidence), and the reader for the plan's single
//     `harness-outcome:` line (AC.4).
//
// `.claude/skills/smoke-test/SKILL.md` lives OUTSIDE `plugins/dev-process-toolkit`
// and therefore carries no line cap and no STE-N token ceiling; ticket ids may
// be cited freely there and here.

import { describe, expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  bindCapture,
  capturePathFor,
  checkFalsifiability,
  classifyMutation,
  extractAssertionShell,
  FALSIFIABILITY_FIXTURE_DIR,
  HARNESS_OUTCOME_TOKENS,
  harnessOutcomeFor,
  M127_REPAIRS,
  M127_REPAIR_ROSTER,
  readHarnessOutcome,
  removeSubject,
  runAssertion,
  SMOKE_SKILL_RELATIVE_PATH,
  uncoveredRepairs,
  type FalsifiabilityResult,
} from "../adapters/_shared/src/falsifiability_harness";
import { DERIVED_FIXTURE_BYTE_CEILING } from "../adapters/_shared/src/capture_artifact_identity";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const SMOKE_SKILL = join(REPO_ROOT, ".claude", "skills", "smoke-test", "SKILL.md");
const M127_PLAN = join(REPO_ROOT, "specs", "plan", "M127.md");

const SKILL_BODY = readFileSync(SMOKE_SKILL, "utf8");
const PLAN_BODY = readFileSync(M127_PLAN, "utf8");

// The stable real-file subject: fixture group 6's single shell span. Untouched
// by M127's six repairs, and `CAP_ASSERT` occurs exactly once in that section.
const GROUP_6_SITE = { section: "Fixture group 6", select: "CAP_ASSERT" } as const;

// The subject the shipped fixtures carry, and the shell that reads it. The
// shell is written here rather than lifted from the SKILL on purpose: the
// execution half must stay measurable while group 7's own bytes are still
// mid-repair. The extraction half is what pins "no paraphrase", and it runs
// against the real file above.
const FENCE_SUBJECT = "```tdd-result";
const COUNTING_SHELL = "grep -c '```tdd-result' /tmp/dpt-smoke-<tracker>-implement.log";

// Measured against the shipped slices on 2026-08-17. `grep -c` counts LINES.
const LEGS = ["linear", "jira", "none"] as const;
const PRESENT_LINE_COUNTS: Record<(typeof LEGS)[number], number> = {
  linear: 9,
  jira: 7,
  none: 7,
};
const SUBJECT_OCCURRENCES: Record<(typeof LEGS)[number], number> = {
  linear: 18,
  jira: 14,
  none: 14,
};

function runOneLeg(leg: (typeof LEGS)[number]): FalsifiabilityResult {
  return checkFalsifiability({
    id: `fixture-${leg}`,
    shell: COUNTING_SHELL,
    capturePath: capturePathFor(leg),
    subject: FENCE_SUBJECT,
    threshold: 3,
  });
}

// ---------------------------------------------------------------------------
// AC-STE-483.1 — extract the shell form from the SKILL and execute it, never
// re-derive or paraphrase it.
// ---------------------------------------------------------------------------

describe("AC-STE-483.1 — extract-and-execute, never paraphrase", () => {
  test("the harness targets the maintainer's smoke SKILL by path", () => {
    expect(SMOKE_SKILL_RELATIVE_PATH).toBe(".claude/skills/smoke-test/SKILL.md");
    expect(readFileSync(join(REPO_ROOT, SMOKE_SKILL_RELATIVE_PATH), "utf8")).toBe(SKILL_BODY);
  });

  test("the extracted shell is VERBATIM bytes of the real SKILL", () => {
    const extracted = extractAssertionShell(SKILL_BODY, GROUP_6_SITE);

    // The whole claim of AC.1 in one assertion: the bytes the harness will run
    // are bytes that are physically in the file, not a remembered equivalent.
    expect(SKILL_BODY).toContain(extracted.shell);
    expect(extracted.shell).toContain("CAP_ASSERT");
    expect(extracted.shell).toContain("/tmp/dpt-smoke-<tracker>-spec-write.log");

    // And it is the assertion span, not the surrounding bullet prose.
    expect(extracted.shell.startsWith("bun ")).toBe(true);
    expect(extracted.shell).not.toContain("exit 0 (at least one");

    // Cited by line so a failure names where in the SKILL to look.
    const lines = SKILL_BODY.split("\n");
    expect(lines[extracted.line - 1]).toContain(extracted.shell);
  });

  test("a one-token rewording of that span in the SKILL makes extraction FAIL", () => {
    const extracted = extractAssertionShell(SKILL_BODY, GROUP_6_SITE);

    // Sited mutation with a uniqueness proof: a whole-document replace that
    // landed on some other copy would manufacture evidence.
    const at = SKILL_BODY.indexOf(extracted.shell);
    expect(at).toBeGreaterThan(-1);
    expect(SKILL_BODY.indexOf(extracted.shell, at + 1)).toBe(-1);

    const reworded = extracted.shell.replace("CAP_ASSERT", "CAPABILITY_ASSERT");
    expect(reworded).not.toBe(extracted.shell);
    const mutatedSkill =
      SKILL_BODY.slice(0, at) + reworded + SKILL_BODY.slice(at + extracted.shell.length);

    // The mutation APPLIED — measured by count, not assumed (AC.6 discipline
    // applied to the harness's own test).
    expect(mutatedSkill.split(extracted.shell).length - 1).toBe(0);
    expect(mutatedSkill.split(reworded).length - 1).toBe(1);

    // A harness carrying its own paraphrase would sail straight past this.
    expect(() => extractAssertionShell(mutatedSkill, GROUP_6_SITE)).toThrow();
  });

  test("an ambiguous site is refused, not guessed", () => {
    const body = [
      "#### Fixture group X",
      "",
      "- Assert: `grep -c 'alpha' /tmp/dpt-smoke-<tracker>-implement.log` exit 0.",
      "- Assert: `grep -c 'alpha' /tmp/dpt-smoke-<tracker>-spec-write.log` exit 0.",
      "",
    ].join("\n");

    expect(() => extractAssertionShell(body, { section: "Fixture group X", select: "alpha" })).toThrow();

    // Disambiguating by a literal unique to one span resolves it.
    const one = extractAssertionShell(body, {
      section: "Fixture group X",
      select: "spec-write.log",
    });
    expect(one.shell).toBe("grep -c 'alpha' /tmp/dpt-smoke-<tracker>-spec-write.log");
  });

  test("an absent site is refused, not silently skipped", () => {
    expect(() =>
      extractAssertionShell(SKILL_BODY, { section: "Fixture group 6", select: "no-such-token" }),
    ).toThrow();
    expect(() =>
      extractAssertionShell(SKILL_BODY, { section: "Fixture group 4242", select: "CAP_ASSERT" }),
    ).toThrow();
  });

  test("the section slicer stops at the next heading of the same depth", () => {
    const body = [
      "#### Group A",
      "",
      "- Assert: `grep -c 'aaa' /tmp/dpt-smoke-<tracker>-implement.log` exit 0.",
      "",
      "##### Sub-fixture A1",
      "",
      "- Assert: `grep -c 'bbb' /tmp/dpt-smoke-<tracker>-implement.log` exit 0.",
      "",
      "#### Group B",
      "",
      "- Assert: `grep -c 'ccc' /tmp/dpt-smoke-<tracker>-implement.log` exit 0.",
      "",
    ].join("\n");

    // A nested `#####` sub-fixture is INSIDE its `####` parent.
    expect(extractAssertionShell(body, { section: "Group A", select: "bbb" }).shell).toContain("bbb");
    // The next same-depth heading ends the section — group B does not bleed in.
    expect(() => extractAssertionShell(body, { section: "Group A", select: "ccc" })).toThrow();
    // And a sub-fixture site sees only its own span.
    expect(() => extractAssertionShell(body, { section: "Sub-fixture A1", select: "aaa" })).toThrow();
  });

  test("double-backtick spans are extracted, fence tokens intact", () => {
    const body = [
      "#### Group 7ish",
      "",
      "- ``grep -c '^```tdd-result$' /tmp/dpt-smoke-<tracker>-implement.log`` ≥ 3 (prose).",
      "",
    ].join("\n");

    const extracted = extractAssertionShell(body, {
      section: "Group 7ish",
      select: "^```tdd-result$",
    });
    expect(extracted.shell).toBe("grep -c '^```tdd-result$' /tmp/dpt-smoke-<tracker>-implement.log");
  });

  test("bindCapture rewrites ONLY the capture path", () => {
    const capture = capturePathFor("linear");
    const bound = bindCapture(COUNTING_SHELL, capture);

    expect(bound.capturePath).toBe(capture);
    expect(bound.command).toContain(capture);
    expect(bound.command).not.toContain("<tracker>");
    // Byte-for-byte the SKILL's form everywhere except the path token.
    expect(bound.command.replace(capture, "/tmp/dpt-smoke-<tracker>-implement.log")).toBe(
      COUNTING_SHELL,
    );

    // A shell with no capture-path token cannot be bound — the harness would
    // otherwise execute a command that never reads the fixture at all.
    expect(() => bindCapture("grep -c 'x' notes.txt", capture)).toThrow();
  });

  test("runAssertion executes the bound bytes and reports a count", () => {
    const bound = bindCapture(COUNTING_SHELL, capturePathFor("linear"));
    const run = runAssertion(bound);

    expect(run.command).toBe(bound.command);
    expect(run.exitCode).toBe(0);
    expect(run.count).toBe(PRESENT_LINE_COUNTS.linear);

    // A non-zero exit is data, not a crash: `grep -c` exits 1 on zero matches.
    const empty = runAssertion(
      bindCapture(
        "grep -c 'no-such-token-anywhere' /tmp/dpt-smoke-<tracker>-implement.log",
        capturePathFor("linear"),
      ),
    );
    expect(empty.exitCode).toBe(1);
    expect(empty.count).toBe(0);

    // Non-integer stdout falls back to a non-empty-line count.
    const listed = runAssertion(
      bindCapture(
        "grep -o '```tdd-result' /tmp/dpt-smoke-<tracker>-implement.log",
        capturePathFor("linear"),
      ),
    );
    expect(listed.count).toBe(SUBJECT_OCCURRENCES.linear);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-483.2 — passes present, fails absent; either half missing is a
// harness failure, not a pass.
// ---------------------------------------------------------------------------

describe("AC-STE-483.2 — non-vacuity in BOTH directions", () => {
  test("present-subject passes and absent-subject fails, on every shipped leg", () => {
    for (const leg of LEGS) {
      const result = runOneLeg(leg);
      expect(result.presentCount, `${leg} present`).toBe(PRESENT_LINE_COUNTS[leg]);
      expect(result.absentCount, `${leg} absent`).toBe(0);
      expect(result.removed, `${leg} removed`).toBe(SUBJECT_OCCURRENCES[leg]);
      expect(result.verdict, `${leg} verdict`).toBe("falsifiable");
    }
  });

  test("an assertion that passes on BOTH captures is vacuous, not a pass", () => {
    // `grep -c ''` matches every line, subject or no subject.
    const result = checkFalsifiability({
      id: "matches-everything",
      shell: "grep -c '' /tmp/dpt-smoke-<tracker>-implement.log",
      capturePath: capturePathFor("linear"),
      subject: FENCE_SUBJECT,
      threshold: 3,
    });
    expect(result.presentCount).toBeGreaterThanOrEqual(3);
    expect(result.absentCount).toBeGreaterThanOrEqual(3);
    expect(result.verdict).toBe("vacuous");
  });

  test("an assertion that fails on BOTH captures is vacuous, not a pass", () => {
    // The half the 2026-08-16 run actually hit: a line-anchored grep over
    // NDJSON scores 0 on a HEALTHY capture. Falsifiable-looking (it does go
    // red when the subject leaves) yet worthless — it never passes at all.
    const result = checkFalsifiability({
      id: "line-anchored-on-ndjson",
      shell: "grep -c '^```tdd-result$' /tmp/dpt-smoke-<tracker>-implement.log",
      capturePath: capturePathFor("linear"),
      subject: FENCE_SUBJECT,
      threshold: 3,
    });
    expect(result.presentCount).toBe(0);
    expect(result.absentCount).toBe(0);
    expect(result.verdict).toBe("vacuous");
  });

  test("harnessOutcomeFor refuses an EMPTY result set", () => {
    // Zero results is not evidence. A harness that answered "harness-fails"
    // over nothing at all is the exact defect this FR exists to retire.
    expect(() => harnessOutcomeFor([])).toThrow();
  });

  test("harnessOutcomeFor is vacuous if ANY single result is", () => {
    const good = runOneLeg("linear");
    const bad: FalsifiabilityResult = { ...good, id: "bad", verdict: "vacuous" };
    expect(harnessOutcomeFor([good])).toBe("harness-fails");
    expect(harnessOutcomeFor([good, bad])).toBe("harness-vacuous");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-483.3 — the mutation removes the actual subject; a rewording is not
// evidence.
// ---------------------------------------------------------------------------

describe("AC-STE-483.3 — mutate the SUBJECT, not a nearby wording", () => {
  const original = readFileSync(capturePathFor("linear"), "utf8");

  test("classifyMutation separates the three cases", () => {
    expect(classifyMutation(original, original, FENCE_SUBJECT)).toBe("not-applied");

    // Bytes changed, subject occurrence count unchanged — a rewording.
    const reworded = original.replace("test-writer", "test_writer");
    expect(reworded).not.toBe(original);
    expect(reworded.split(FENCE_SUBJECT).length - 1).toBe(
      original.split(FENCE_SUBJECT).length - 1,
    );
    expect(classifyMutation(original, reworded, FENCE_SUBJECT)).toBe("rewording-only");

    const removed = removeSubject(original, FENCE_SUBJECT).text;
    expect(classifyMutation(original, removed, FENCE_SUBJECT)).toBe("subject-removed");
  });

  test("checkFalsifiability REFUSES a rewording-only mutation", () => {
    expect(() =>
      checkFalsifiability({
        id: "reworded",
        shell: COUNTING_SHELL,
        capturePath: capturePathFor("linear"),
        subject: FENCE_SUBJECT,
        threshold: 3,
        mutate: (capture) => capture.replace("test-writer", "test_writer"),
      }),
    ).toThrow();
  });

  test("checkFalsifiability REFUSES a mutation that changed nothing", () => {
    expect(() =>
      checkFalsifiability({
        id: "identity",
        shell: COUNTING_SHELL,
        capturePath: capturePathFor("linear"),
        subject: FENCE_SUBJECT,
        threshold: 3,
        mutate: (capture) => capture,
      }),
    ).toThrow();
  });

  test("a subject-removing mutation IS accepted", () => {
    const result = checkFalsifiability({
      id: "explicit-removal",
      shell: COUNTING_SHELL,
      capturePath: capturePathFor("linear"),
      subject: FENCE_SUBJECT,
      threshold: 3,
      mutate: (capture) => removeSubject(capture, FENCE_SUBJECT).text,
    });
    expect(result.verdict).toBe("falsifiable");
    expect(result.absentCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-483.4 — the plan records exactly one literal token.
// ---------------------------------------------------------------------------

describe("AC-STE-483.4 — the halt token in specs/plan/M127.md", () => {
  test("the two tokens are the only vocabulary", () => {
    expect([...HARNESS_OUTCOME_TOKENS]).toEqual(["harness-fails", "harness-vacuous"]);
  });

  test("readHarnessOutcome requires exactly one resolved harness-outcome line", () => {
    expect(readHarnessOutcome("harness-outcome: harness-fails\n")).toBe("harness-fails");
    expect(readHarnessOutcome("harness-outcome: harness-vacuous\n")).toBe("harness-vacuous");

    // The unresolved placeholder shape names BOTH tokens — it must not read as
    // a recorded outcome.
    expect(() =>
      readHarnessOutcome("harness-outcome: <unresolved — records harness-fails | harness-vacuous>\n"),
    ).toThrow();
    // Two lines is not "exactly one".
    expect(() =>
      readHarnessOutcome("harness-outcome: harness-fails\nharness-outcome: harness-vacuous\n"),
    ).toThrow();
    // No line at all.
    expect(() => readHarnessOutcome("# Implementation Plan\n")).toThrow();
    // A token that is not one of the two.
    expect(() => readHarnessOutcome("harness-outcome: harness-ok\n")).toThrow();
  });

  test("M127.md records a token, and it MATCHES what the harness demonstrates", () => {
    const recorded = readHarnessOutcome(PLAN_BODY);
    expect(HARNESS_OUTCOME_TOKENS).toContain(recorded);

    // The token is not an aspiration — it must equal the live verdict over the
    // shipped fixtures. A stale `harness-fails` left behind after the harness
    // went vacuous fails right here.
    const live = harnessOutcomeFor(LEGS.map((leg) => runOneLeg(leg)));
    expect(recorded).toBe(live);
  });

  test("the recorded token is `harness-fails` — `harness-vacuous` HALTS M127", () => {
    // Deliberately a separate, loudly named test: if this one is the red one,
    // the milestone stops and the operator decides. Shipping assertions that
    // cannot fail is explicitly not an option.
    expect(readHarnessOutcome(PLAN_BODY)).toBe("harness-fails");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-483.5 — re-runnable, captures ship as repo fixtures.
// ---------------------------------------------------------------------------

describe("AC-STE-483.5 — offline re-runnability", () => {
  test("the fixture dir is in the repo, never /tmp", () => {
    expect(FALSIFIABILITY_FIXTURE_DIR).toBe(
      join(PLUGIN_ROOT, "tests", "fixtures", "m127-falsifiability"),
    );
    expect(FALSIFIABILITY_FIXTURE_DIR.startsWith("/tmp")).toBe(false);
    expect(statSync(FALSIFIABILITY_FIXTURE_DIR).isDirectory()).toBe(true);

    for (const leg of LEGS) {
      const path = capturePathFor(leg);
      expect(path).toBe(join(FALSIFIABILITY_FIXTURE_DIR, `implement-${leg}.ndjson`));
      expect(statSync(path).isFile()).toBe(true);
    }
  });

  test("each shipped slice is a faithful, committable capture", () => {
    for (const leg of LEGS) {
      const text = readFileSync(capturePathFor(leg), "utf8");

      // Faithful: it carries the subject, at the count the source capture had.
      expect(text.split(FENCE_SUBJECT).length - 1, `${leg} subject count`).toBe(
        SUBJECT_OCCURRENCES[leg],
      );

      // Committable: a derived slice, well under the house ceiling for this
      // fixture family, rather than a megabyte of run artifact.
      expect(
        Buffer.byteLength(text, "utf8"),
        `${leg} bytes`,
      ).toBeLessThan(DERIVED_FIXTURE_BYTE_CEILING);

      // Still a capture: every non-empty line is a stream-json event.
      const lines = text.split("\n").filter((l) => l.trim() !== "");
      expect(lines.length, `${leg} events`).toBeGreaterThan(0);
      for (const line of lines) {
        expect(() => JSON.parse(line)).not.toThrow();
      }
    }
  });

  test("re-running yields the same verdict and leaves the fixture untouched", () => {
    const path = capturePathFor("linear");
    const before = readFileSync(path, "utf8");

    const first = runOneLeg("linear");
    const second = runOneLeg("linear");

    expect(second.presentCount).toBe(first.presentCount);
    expect(second.absentCount).toBe(first.absentCount);
    expect(second.verdict).toBe(first.verdict);
    expect(second.command).toBe(first.command);

    // The mutation is derived, never written back over the shipped evidence.
    expect(readFileSync(path, "utf8")).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-483.6 — assert a marker COUNT; a mutation that never applied must not
// read as a pass.
// ---------------------------------------------------------------------------

describe("AC-STE-483.6 — counts, not presence", () => {
  test("removeSubject reports how many markers it removed", () => {
    for (const leg of LEGS) {
      const original = readFileSync(capturePathFor(leg), "utf8");
      const { text, removed } = removeSubject(original, FENCE_SUBJECT);
      expect(removed, `${leg} removed`).toBe(SUBJECT_OCCURRENCES[leg]);
      expect(text.split(FENCE_SUBJECT).length - 1, `${leg} residue`).toBe(0);
      expect(text.length).toBeLessThan(original.length);
    }
  });

  test("a mutation that never applied THROWS instead of reading as a pass", () => {
    const original = readFileSync(capturePathFor("linear"), "utf8");
    // The M124 shape: the subject is not there, the replace is a no-op, and a
    // presence-only harness would score the unchanged capture as "went red".
    expect(() => removeSubject(original, "subject-that-is-not-in-the-capture")).toThrow();
    expect(() => removeSubject("", FENCE_SUBJECT)).toThrow();
  });

  test("the verdict is decided by counts against a threshold, not by presence", () => {
    const capture = capturePathFor("linear");

    // Present count 9 clears a threshold of 9 and misses a threshold of 10 —
    // the same subject, the same capture, two verdicts. A presence-only check
    // could not tell these apart.
    const clears = checkFalsifiability({
      id: "threshold-9",
      shell: COUNTING_SHELL,
      capturePath: capture,
      subject: FENCE_SUBJECT,
      threshold: PRESENT_LINE_COUNTS.linear,
    });
    expect(clears.verdict).toBe("falsifiable");

    const misses = checkFalsifiability({
      id: "threshold-10",
      shell: COUNTING_SHELL,
      capturePath: capture,
      subject: FENCE_SUBJECT,
      threshold: PRESENT_LINE_COUNTS.linear + 1,
    });
    expect(misses.presentCount).toBe(PRESENT_LINE_COUNTS.linear);
    expect(misses.verdict).toBe("vacuous");
  });
});

// ---------------------------------------------------------------------------
// The registry — it starts empty/partial and grows. The "zero uncovered" gate
// belongs to M127 task 10, once all six repairs have landed; what is pinned
// here is that the enumeration machinery itself cannot go quiet.
// ---------------------------------------------------------------------------

describe("repair registry enumeration", () => {
  const sample = (id: string) => ({
    id,
    site: { section: "Fixture group 6", select: "CAP_ASSERT" },
    subject: FENCE_SUBJECT,
    leg: "linear" as const,
    threshold: 3,
  });

  test("the roster is exactly M127's six repairs, in plan order", () => {
    expect([...M127_REPAIR_ROSTER]).toEqual([
      "STE-484",
      "STE-485",
      "STE-486",
      "STE-487",
      "STE-488",
      "STE-489",
    ]);
  });

  test("uncoveredRepairs reports the gap, and shrinks as repairs register", () => {
    expect([...uncoveredRepairs([], M127_REPAIR_ROSTER)]).toEqual([...M127_REPAIR_ROSTER]);

    expect([...uncoveredRepairs([sample("STE-484")], M127_REPAIR_ROSTER)]).toEqual([
      "STE-485",
      "STE-486",
      "STE-487",
      "STE-488",
      "STE-489",
    ]);

    expect(
      uncoveredRepairs(
        M127_REPAIR_ROSTER.map((id) => sample(id)),
        M127_REPAIR_ROSTER,
      ),
    ).toEqual([]);
  });

  test("an unknown or duplicated registry id is a registry defect", () => {
    expect(() => uncoveredRepairs([sample("STE-999")], M127_REPAIR_ROSTER)).toThrow();
    expect(() =>
      uncoveredRepairs([sample("STE-484"), sample("STE-484")], M127_REPAIR_ROSTER),
    ).toThrow();
  });

  test("every registered entry names a SITE, never its own shell copy", () => {
    // The paraphrase AC.1 forbids would enter the codebase exactly here — as a
    // convenience `shell:` field on a registry row.
    expect(() => uncoveredRepairs(M127_REPAIRS, M127_REPAIR_ROSTER)).not.toThrow();
    for (const entry of M127_REPAIRS) {
      expect(Object.keys(entry)).not.toContain("shell");
      expect(Object.keys(entry)).not.toContain("command");
      expect(entry.site.section.length).toBeGreaterThan(0);
      expect(entry.site.select.length).toBeGreaterThan(0);
      // A registered site must actually resolve against the live SKILL.
      expect(() => extractAssertionShell(SKILL_BODY, entry.site)).not.toThrow();
    }
  });
});

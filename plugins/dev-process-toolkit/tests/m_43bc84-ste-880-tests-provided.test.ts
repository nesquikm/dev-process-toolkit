// STE-880 (M_43bc84) — `/tdd <FR-id> --tests-provided <path...>` replaces the
// test-writer stage with an orchestrator-run RED check of the named existing test
// files; `/implement` accepts the same flag and passes it through.
// Contract tests over the /tdd and /implement skill texts, the halt reporter and
// the retry budget. Each test names the mutant it kills.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { formatHaltReport } from "../adapters/_shared/src/tdd_halt_report";
import { newRetryBudget, recordTddFailure } from "../adapters/_shared/src/tdd_retry_state";
import {
  HINT_INDEX,
  HINT_NEW,
  HINT_NEW_STE738,
  STEP_8_APPEND,
  STEP_8_APPEND_STE738,
  STEP_8_INDEX,
  undoAdmissions,
  undoSte745,
  undoSte835,
} from "./_m_5f3c43_ste738_implement_admissions";

const PLUGIN = join(import.meta.dir, "..");
const read = (rel: string): string => readFileSync(join(PLUGIN, rel), "utf8");
const TDD = read("skills/tdd/SKILL.md");
const IMPLEMENT = read("skills/implement/SKILL.md");
const FLAG = "--tests-provided";

/** A skill's frontmatter argument-hint, or null. */
function argumentHint(text: string): string | null {
  const m = /^argument-hint: (.*)$/m.exec(text);
  return m ? m[1]! : null;
}

/** The body of the section opened by the heading line starting with `heading`, up to the next heading of the same or higher level. */
function section(text: string, heading: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.startsWith(heading));
  if (start < 0) throw new Error(`no heading starting with ${JSON.stringify(heading)}`);
  const level = /^#+/.exec(heading)![0]!.length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^(#+) /.exec(lines[i]!);
    if (m && m[1]!.length <= level) {
      end = i;
      break;
    }
  }
  return lines.slice(start + 1, end).join("\n");
}

/** The blank-line-separated paragraphs (and list items) of a text that carry every phrase. */
function carrying(text: string, ...phrases: string[]): string[] {
  const blocks = text.split(/\n\s*\n|\n(?=\s*- )/);
  return blocks.filter((b) => phrases.every((p) => b.includes(p)));
}

describe("AC-STE-880.1 — the flag takes paths, and a bad path refuses before the receipt", () => {
  // Kills: the /tdd argument-hint not declaring the flag.
  test("the /tdd argument-hint names --tests-provided <path...>", () => {
    expect(argumentHint(TDD)).toBe("'<FR-id> [--resume-at <AC-id>|refactor|audit] [--tests-provided <path...>]'");
  });

  // Kills: Inputs not describing the flag as taking one or more paths.
  test("Inputs names --tests-provided taking one or more paths", () => {
    const inputs = section(TDD, "## Inputs");
    expect(carrying(inputs, "`--tests-provided <path...>`", "one or more").length).toBeGreaterThanOrEqual(1);
  });

  // Kills: the path check dropped, or placed after the receipt / a dispatch.
  test("a missing path, or one outside the repository, refuses in the NFR-10 shape before the receipt and before any fork", () => {
    const hits = carrying(TDD, FLAG, "does not exist", "outside the repository", "NFR-10", "before the receipt", "before any fork");
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  // Kills: the check stated only in prose far from § 1, where the receipt is recorded.
  test("§ 1, where the receipt is recorded, carries the path check", () => {
    const s1 = section(TDD, "### 1.");
    expect(carrying(s1, FLAG, "before the receipt").length).toBeGreaterThanOrEqual(1);
  });
});

describe("AC-STE-880.2 — Stage RED runs the named files instead of the test-writer", () => {
  const red = section(TDD, "### 2.");

  // Kills: the test-writer still dispatched at Stage RED on a --tests-provided run.
  test("Stage RED states no test-writer fork is dispatched on a --tests-provided run", () => {
    expect(carrying(red, FLAG, "no test-writer fork").length).toBeGreaterThanOrEqual(1);
  });

  // Kills: the RED check run with something other than the project's test command, or accepting all-GREEN.
  test("Stage RED runs the named files with the project's test command and requires at least one failing test", () => {
    expect(carrying(red, FLAG, "project's test command", "at least one failing test").length).toBeGreaterThanOrEqual(1);
  });

  // Kills: an all-GREEN provided run continuing to GREEN instead of halting.
  test("every named test passing halts with the named failure mode provided-tests-pass, and no implementer fork", () => {
    expect(carrying(red, "`provided-tests-pass`", "no implementer fork").length).toBeGreaterThanOrEqual(1);
  });

  // Kills: the failure-mode catalogue not listing the new mode.
  test("Failure modes lists provided-tests-pass", () => {
    const modes = section(TDD, "## Failure modes");
    expect(carrying(modes, "**provided-tests-pass**").length).toBe(1);
  });

  // Kills: the Rules allowing a Stage RED test-writer on a --tests-provided run.
  test("Rules forbid a Stage RED test-writer dispatch on a --tests-provided run", () => {
    const rules = section(TDD, "## Rules").split("\n").filter((l) => l.startsWith("- Do NOT dispatch the test-writer"));
    expect(rules.some((l) => l.includes(`\`${FLAG}\``))).toBe(true);
  });

  // Kills: the formatter not knowing the mode (a halt report reading `undefined`).
  test("formatHaltReport renders the provided-tests-pass mode with its own description", () => {
    const out = formatHaltReport({
      mode: "provided-tests-pass" as never,
      role: "test-writer",
      fr: "STE-9001",
      retryCount: 0,
      rawOutput: "3 pass\n0 fail",
      testsProvided: ["tests/widget-a.test.ts"],
    } as never);
    expect(out).toContain("failure mode: provided-tests-pass (");
    expect(out).not.toContain("undefined");
  });

  // Kills: the mode retried (re-running provided tests cannot make them fail) or spending budget.
  test("recordTddFailure halts provided-tests-pass on the first occurrence", () => {
    const budget = newRetryBudget();
    const d = recordTddFailure(budget, { role: "test-writer" }, "provided-tests-pass" as never);
    expect(d.decision).toBe("halt");
    expect(d.attemptNumber).toBe(1);
  });
});

describe("AC-STE-880.3 — GREEN per AC with the named files; REFACTOR and AUDIT unchanged", () => {
  // Kills: the implementer handed some other command on a provided run.
  test("Stage GREEN passes the named files as the failing-test command on a --tests-provided run", () => {
    const green = section(TDD, "### 3.");
    expect(carrying(green, FLAG, "named files", "failing-test command").length).toBeGreaterThanOrEqual(1);
  });

  // Kills: the AUDIT retry round barred from the test-writer on a provided run.
  test("the AUDIT retry round may still dispatch the test-writer for the ACs the audit reports missing", () => {
    expect(carrying(TDD, FLAG, "retry round", "test-writer", "reports missing").length).toBeGreaterThanOrEqual(1);
  });

  // Kills: per-AC dispatch dropped on a provided run.
  test("the per-AC implementer rule still holds", () => {
    expect(section(TDD, "## Rules")).toContain("- Do NOT skip the per-AC implementer dispatch (one fork per AC; no batching).");
  });
});

describe("AC-STE-880.4 — --tests-provided with --resume-at is accepted, Stage RED skipped", () => {
  // Kills: the combination refused, or Stage RED's RED check run on a resume.
  test("a sentence accepts both flags together and skips Stage RED", () => {
    const hits = carrying(TDD, FLAG, "--resume-at", "accepted", "Stage RED is skipped");
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });
});

describe("AC-STE-880.5 — /implement accepts and passes --tests-provided", () => {
  const lines = IMPLEMENT.split("\n");

  // Kills: the /implement hint not naming the flag.
  test("the /implement argument-hint names --tests-provided <path...> after --resume-at", () => {
    expect(lines[HINT_INDEX]).toBe(
      "argument-hint: '<milestone, task description, issue number, \"next\", or \"all\"> [--code-only] [--resume-at <AC-id>|refactor|audit] [--tests-provided <path...>]'",
    );
  });

  // Kills: Phase 2 step 8 not passing the flag through, or naming it in a new line.
  test("Phase 2 step 8 passes --tests-provided <path...> to /tdd in the same sentence as --resume-at", () => {
    const step8 = lines[STEP_8_INDEX]!;
    expect(step8.startsWith("   invoke `/dev-process-toolkit:tdd <FR-id>` inline")).toBe(true);
    expect(step8.endsWith(STEP_8_APPEND)).toBe(true);
    const sentence = STEP_8_APPEND.split(/;\s+/).find((x) => x.includes("--resume-at <point>` "))!;
    expect(sentence).toContain("`--tests-provided <path...>`");
    expect(sentence).toContain("`/dev-process-toolkit:tdd <FR-id> --tests-provided <path...>`");
  });

  // Kills: the admission widened beyond replacing words (a whole rewrite riding the amendment).
  test("falsifier: each amended admission is its STE-738 predecessor with words inserted, nothing else", () => {
    expect(HINT_NEW.replace(" [--tests-provided <path...>]", "")).toBe(HINT_NEW_STE738);
    expect(
      STEP_8_APPEND
        .replace(" follows the FR, or `--tests-provided <path...>` does,", " follows the FR,")
        .replace(" or `/dev-process-toolkit:tdd <FR-id> --tests-provided <path...>`:", ":"),
    ).toBe(STEP_8_APPEND_STE738);
  });

  // Kills: undoAdmissions still admitting the pre-STE-880 bytes (the freeze would not demand the edit).
  test("falsifier: a file carrying only the STE-738 hint and step-8 append is refused by the admissions", () => {
    const s745 = undoSte745(lines);
    if ("error" in s745) throw new Error(s745.error);
    const s835 = undoSte835(s745.lines);
    if ("error" in s835) throw new Error(s835.error);
    const base = s835.lines;
    const oldHint = [...base];
    oldHint[HINT_INDEX] = oldHint[HINT_INDEX]!.replace(HINT_NEW, HINT_NEW_STE738);
    expect(oldHint[HINT_INDEX]!.endsWith(HINT_NEW_STE738)).toBe(true);
    expect(undoAdmissions(oldHint)).toHaveProperty("error");
    const oldStep8 = [...base];
    oldStep8[STEP_8_INDEX] = oldStep8[STEP_8_INDEX]!.replace(STEP_8_APPEND, STEP_8_APPEND_STE738);
    expect(oldStep8[STEP_8_INDEX]!.endsWith(STEP_8_APPEND_STE738)).toBe(true);
    expect(undoAdmissions(oldStep8)).toHaveProperty("error");
  });

  // Kills: the edit added a line to /implement (NFR-1 cap 362).
  test("skills/implement/SKILL.md stays within its 362-line cap", () => {
    expect(IMPLEMENT.split("\n").length - (IMPLEMENT.endsWith("\n") ? 1 : 0)).toBeLessThanOrEqual(362);
  });
});

describe("AC-STE-880.6 — the reports say the tests were provided, and name the files", () => {
  const files = ["tests/widget-a.test.ts", "tests/widget-b.test.ts"];

  // Kills: the success report not distinguishing provided tests from written ones.
  test("the /tdd success report says the tests were provided rather than written, and names the files", () => {
    const report = section(TDD, "## Success report");
    expect(carrying(report, FLAG, "provided, not written", "names the files").length).toBeGreaterThanOrEqual(1);
  });

  // Kills: the halt path not passing the provided files to the reporter.
  test("the /tdd halt path passes the provided files to formatHaltReport", () => {
    expect(section(TDD, "## Halt path")).toContain("testsProvided");
  });

  // Kills: a provided-tests-pass halt report omitting the provided files.
  test("a provided-tests-pass halt report says the tests were provided, not written, and names each file", () => {
    const out = formatHaltReport({
      mode: "provided-tests-pass" as never,
      role: "test-writer",
      fr: "STE-9001",
      retryCount: 0,
      rawOutput: "4 pass\n0 fail",
      testsProvided: files,
    } as never);
    expect(out).toContain("tests provided, not written: tests/widget-a.test.ts, tests/widget-b.test.ts");
  });

  // Kills: the provided line rendered only for the RED-check halt, not a later implementer halt on a provided run.
  test("an implementer halt on a provided run also names the provided files", () => {
    const out = formatHaltReport({
      mode: "B",
      role: "implementer",
      entry: "implement",
      fr: "STE-9001",
      ac: "AC-STE-9001.2",
      retryCount: 2,
      rawOutput: "1 fail",
      testsProvided: files,
    } as never);
    expect(out).toContain("tests provided, not written: tests/widget-a.test.ts, tests/widget-b.test.ts");
  });

  // Kills: the provided line printed on every halt, provided or not.
  test("control: a halt without provided tests carries no provided line", () => {
    const out = formatHaltReport({ mode: "B", role: "implementer", fr: "STE-9001", ac: "AC-STE-9001.2", retryCount: 2, rawOutput: "1 fail" });
    expect(out).not.toContain("tests provided");
  });
});

// Phase 3 Stage A (M_43bc84 review): a provided-tests-pass halt fires on its
// first occurrence, so "bounded retry budget exhausted" was false, and the
// generic remedy (re-run after a test-writer false-RED…) never told the
// operator what to check.
describe("AC-STE-880.2 hardening — the provided-tests-pass halt says what happened and what to do", () => {
  const out = formatHaltReport({
    mode: "provided-tests-pass",
    role: "test-writer",
    entry: "implement",
    fr: "STE-9001",
    retryCount: 0,
    rawOutput: " 4 pass\n 0 fail",
    testsProvided: ["tests/widget.test.ts", "tests/gadget.test.ts"],
  });

  test("the header does not claim a retry budget ran out", () => {
    expect(out.split("\n")[0]).toBe("/dev-process-toolkit:tdd: halt — every provided test already passes.");
    expect(out).not.toContain("bounded retry budget exhausted");
  });

  test("the remedy names the two checks and the re-run, not the generic false-RED wording", () => {
    const remedy = out.split("\n").find((l) => l.startsWith("Remedy:")) ?? "";
    expect(remedy).toContain("tests/widget.test.ts, tests/gadget.test.ts");
    expect(remedy).toContain("already implemented");
    expect(remedy).toContain("/dev-process-toolkit:implement STE-9001 --tests-provided");
    expect(remedy).not.toContain("test-writer false-RED");
  });
});

// Supervisor review (M_43bc84): every resume command and remedy line on a
// provided run must carry `--tests-provided <files>`, or the resumed run falls
// back to the whole project test command and loses the provided-tests report.
describe("AC-STE-880.3/.4/.6 hardening — resume commands keep --tests-provided", () => {
  const FILES = ["tests/a.test.ts", "tests/b.test.ts"];
  const FLAG = "--tests-provided tests/a.test.ts tests/b.test.ts";
  const base = { entry: "implement" as const, fr: "STE-9001", retryCount: 2, rawOutput: "1 fail", testsProvided: FILES };
  const remedy = (out: string): string => out.split("\n").find((l) => l.startsWith("Remedy:")) ?? "";

  const cases: [string, Record<string, unknown>, string][] = [
    ["an implementer halt in Stage GREEN", { mode: "B", role: "implementer", ac: "AC-STE-9001.2" }, "--resume-at AC-STE-9001.2"],
    ["a refactorer halt", { mode: "C", role: "refactorer" }, "--resume-at refactor"],
    ["a spec-reviewer halt", { mode: "D", role: "spec-reviewer" }, "--resume-at audit"],
    ["a spec-gap halt", { mode: "spec-gap", role: "spec-reviewer", missingAcs: ["AC-STE-9001.3"] }, "--resume-at audit"],
    ["an implementer halt in the audit retry round", { mode: "B", role: "implementer", ac: "AC-STE-9001.2", auditRound: true }, "--resume-at audit"],
    ["a test-writer halt in the audit retry round", { mode: "A", role: "test-writer", auditRound: true }, "--resume-at audit"],
    ["a not-load-bearing halt", { mode: "not-load-bearing", role: "implementer", ac: "AC-STE-9001.2" }, "--resume-at AC-STE-9001.2"],
  ];
  for (const [label, extra, resumeAt] of cases) {
    test(`${label}: the remedy's resume command carries ${FLAG}`, () => {
      const out = formatHaltReport({ ...base, ...extra } as never);
      expect(remedy(out)).toContain(`/dev-process-toolkit:implement STE-9001 ${resumeAt} ${FLAG}`);
    });
  }

  test("a run without provided tests keeps the resume command byte-identical (no flag)", () => {
    const out = formatHaltReport({ mode: "B", role: "implementer", entry: "implement", fr: "STE-9001", ac: "AC-STE-9001.2", retryCount: 2, rawOutput: "1 fail" });
    expect(remedy(out)).toContain("/dev-process-toolkit:implement STE-9001 --resume-at AC-STE-9001.2.");
    expect(out).not.toContain("--tests-provided");
  });
});

// Supervisor review round 2 (M_43bc84): a printed resume command must run as
// it stands. Paths with whitespace or shell metacharacters are shell-quoted,
// and the no-resume-point fallback names the entry skill and the flag too.
describe("AC-STE-880.6 hardening — printed commands paste and run as they stand", () => {
  const ODD = ["tests/my dir/a.test.ts", "tests/it's.test.ts", "tests/plain.test.ts"];
  const remedy = (out: string): string => out.split("\n").find((l) => l.startsWith("Remedy:")) ?? "";

  test("paths with a space or a quote are shell-quoted; a shell splits them back into exactly the provided paths", () => {
    const out = formatHaltReport({
      mode: "B", role: "implementer", entry: "implement", fr: "STE-9001", ac: "AC-STE-9001.2",
      retryCount: 2, rawOutput: "1 fail", testsProvided: ODD,
    } as never);
    const line = remedy(out);
    const m = /--tests-provided (.+?)\.?$/.exec(line);
    expect(m).not.toBeNull();
    const argv = Bun.spawnSync(["sh", "-c", `for a in ${m![1]}; do printf '%s\\n' "$a"; done`]).stdout.toString().split("\n").filter(Boolean);
    expect(argv).toEqual(ODD);
    expect(line).toContain("--tests-provided 'tests/my dir/a.test.ts' 'tests/it'\\''s.test.ts' tests/plain.test.ts");
  });

  const fallbacks: [string, Record<string, unknown>][] = [
    ["mode E, an implementer with no AC", { mode: "E", role: "implementer" }],
    ["mode A, a test-writer outside the audit round", { mode: "A", role: "test-writer" }],
  ];
  for (const [label, extra] of fallbacks) {
    test(`${label}: the re-run clause names the entry skill, the FR and --tests-provided`, () => {
      const out = formatHaltReport({
        entry: "implement", fr: "STE-9001", retryCount: 2, rawOutput: "x", testsProvided: ["tests/a.test.ts"], ...extra,
      } as never);
      const line = remedy(out);
      expect(line).toContain("Re-run /dev-process-toolkit:implement against the FR");
      expect(line).toContain("/dev-process-toolkit:implement STE-9001 --tests-provided tests/a.test.ts");
      expect(line).not.toContain("/dev-process-toolkit:tdd ");
    });
  }
});

// STE-738 (M_5f3c43) AC-STE-738.4 — `skills/implement/SKILL.md` stays at
// main's bytes (58d211f8), and PR #121's /implement guidance lives in
// `docs/implement-reference.md` instead.
//
// The AC-STE-722.8 suite (tests/m_d1b4b7-ste-722-skill-text.test.ts) is the
// line freeze; this suite pins the two halves of the move: the SKILL.md bytes,
// and each piece of moved guidance on the reference doc. Each test names the
// mutant it kills.
//
// Amended by AC-STE-738.13 (operator ruling 2026-11-12, v3.5.0 fix round): the
// SKILL.md is main's bytes except lines 4, 92 and 280, which carry the exact
// --resume-at admissions of tests/_m_5f3c43_ste738_implement_admissions.ts.
// Amended by AC-STE-774.4 (M_4daa6e): line 213 also carries the exact
// review_findings record sentence, undone by undoSte774 below.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Amended by AC-STE-788.1 (M_870603): line 102's step-11 gate-check line is undone by undoSte788.
// Amended by AC-STE-878.5 (M_43bc84): line 125's lens-read bullet is undone by undoSte878.
import { ADMITTED_INDEXES, LENS_READ_INDEX, LENS_READ_OLD, STEP_11_INDEX, STEP_11_OLD, undoAdmissions, undoSte788, undoSte745, undoSte835, undoSte878 } from "./_m_5f3c43_ste738_implement_admissions";

// Amended by AC-STE-774.4 (M_4daa6e): line 213 (index 212), Phase 3 step i, carries one exact append — the
// record call gated on `review_findings: on`. Undone before the AC-STE-738.13 admissions; a line that does not
// end with it exactly once does not reverse to main's bytes.
const STEP_I_INDEX = 212;
const STEP_I_STE774_APPEND =
  " Only if the `/gate-check` receipt call printed `review_findings: on`, write each Stage B pass's returned review to a temp file and record its counts with `bun run \"${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/review_findings_receipt.ts\" record \"<checkout root>\" code-review \"<that file>\"`.";

/** The lines with the AC-STE-774.4 step-i append undone, or the reason it is not carried exactly once. */
function undoSte774(lines: readonly string[]): { lines: string[] } | { error: string } {
  const out = [...lines];
  const line = out[STEP_I_INDEX] ?? "";
  if (!line.endsWith(STEP_I_STE774_APPEND) || line.split(STEP_I_STE774_APPEND).length !== 2) {
    return { error: "line 213 does not end with its AC-STE-774.4 record sentence exactly once" };
  }
  out[STEP_I_INDEX] = line.slice(0, -STEP_I_STE774_APPEND.length);
  return { lines: out };
}

const PLUGIN = join(import.meta.dir, "..");
const MAIN_SHA = "58d211f8";
const SKILL_REL = "skills/implement/SKILL.md";
const REFERENCE = readFileSync(join(PLUGIN, "docs", "implement-reference.md"), "utf8");
const paragraphs = REFERENCE.split(/\n\s*\n/);

function atMain(rel: string): string {
  const top = Bun.spawnSync(["git", "-C", PLUGIN, "rev-parse", "--show-toplevel"], { stdout: "pipe" }).stdout.toString().trim();
  const prefix = PLUGIN.slice(top.length + 1);
  const r = Bun.spawnSync(["git", "-C", top, "show", `${MAIN_SHA}:${prefix}/${rel}`], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`git show ${MAIN_SHA}:${prefix}/${rel} failed — this guard never skips: ${r.stderr.toString()}`);
  return r.stdout.toString();
}

/** The reference-doc paragraphs carrying every given phrase. */
const carrying = (...phrases: Array<string | RegExp>): string[] =>
  paragraphs.filter((p) => phrases.every((ph) => (typeof ph === "string" ? p.includes(ph) : ph.test(p))));

describe("AC-STE-738.4 — /implement SKILL.md is main's bytes", () => {
  /** The SKILL.md lines with the AC-STE-738.13 admissions undone, or the reason they cannot be. */
  const undone = (body: string): string => {
    // Amended by AC-STE-835.1 (M_d1e7b1): the STE-835 paragraph and Architecture Note move are undone first.
    // Amended by AC-STE-745.1 (M_d1e7b1): the STE-745 step-14 append is undone before everything.
    const s745 = undoSte745(body.split("\n"));
    if ("error" in s745) return `REFUSED: ${s745.error}`;
    const s835 = undoSte835(s745.lines);
    if ("error" in s835) return `REFUSED: ${s835.error}`;
    // Amended by AC-STE-774.4 (M_4daa6e): the step-i record sentence is undone next.
    const s774 = undoSte774(s835.lines);
    if ("error" in s774) return `REFUSED: ${s774.error}`;
    // Amended by AC-STE-788.1 (M_870603): the step-11 gate-check line is undone next.
    const s788 = undoSte788(s774.lines);
    if ("error" in s788) return `REFUSED: ${s788.error}`;
    // Amended by AC-STE-878.5 (M_43bc84): the lens-read bullet is undone next.
    const s878 = undoSte878(s788.lines);
    if ("error" in s878) return `REFUSED: ${s878.error}`;
    const r = undoAdmissions(s878.lines);
    return "error" in r ? `REFUSED: ${r.error}` : r.lines.join("\n");
  };

  // Kills: any PR #121 hunk left in skills/implement/SKILL.md.
  // Amended by AC-STE-738.13: byte-identical once the three admitted edits are undone.
  test(`skills/implement/SKILL.md is byte-identical to ${MAIN_SHA} but for the AC-STE-738.13 lines`, () => {
    const now = undone(readFileSync(join(PLUGIN, SKILL_REL), "utf8"));
    const then = atMain(SKILL_REL);
    const a = now.split("\n");
    const b = then.split("\n");
    const differing = a.map((l, i) => (l === b[i] ? null : i + 1)).filter((n): n is number => n !== null);
    expect({ lines: `${a.length} vs ${b.length}`, differing: differing.slice(0, 10) }).toEqual({ lines: `${b.length} vs ${b.length}`, differing: [] });
    expect(now === then).toBe(true);
  });

  // Kills: an admission widened to a whole line, or a second edit riding on an admitted one.
  test("AC-STE-738.13 control: a changed neighbour of an admitted line, or a second edit on one, is rejected", () => {
    const body = readFileSync(join(PLUGIN, SKILL_REL), "utf8");
    const then = atMain(SKILL_REL);
    expect(undone(body)).toBe(then);
    const lines = body.split("\n");
    // Amended by AC-STE-774.4 (M_4daa6e): the step-i line is admitted the same way, so it gets the same control.
    // Amended by AC-STE-788.1 (M_870603): the step-11 line is admitted the same way, so it gets the same control.
    // Amended by AC-STE-878.5 (M_43bc84): the lens-read line is admitted the same way, so it gets the same control.
    for (const i of [...ADMITTED_INDEXES, STEP_I_INDEX, STEP_11_INDEX, LENS_READ_INDEX]) {
      for (const n of [i - 1, i, i + 1]) {
        const edited = [...lines];
        edited[n] = `x${edited[n]}`;
        expect({ n, same: undone(edited.join("\n")) === then }).toEqual({ n, same: false });
      }
    }
  });

  // Amended by AC-STE-774.4 (M_4daa6e). Kills: the step-i admission widened to any append, or not required exactly once.
  test("AC-STE-774.4 control: the step-i record sentence dropped, doubled or reworded is rejected", () => {
    const lines = readFileSync(join(PLUGIN, SKILL_REL), "utf8").split("\n");
    const then = atMain(SKILL_REL);
    expect(undone(lines.join("\n"))).toBe(then);
    const dropped = [...lines];
    dropped[STEP_I_INDEX] = dropped[STEP_I_INDEX]!.slice(0, -STEP_I_STE774_APPEND.length);
    const doubled = [...lines];
    doubled[STEP_I_INDEX] = `${doubled[STEP_I_INDEX]}${STEP_I_STE774_APPEND}`;
    const reworded = [...lines];
    reworded[STEP_I_INDEX] = reworded[STEP_I_INDEX]!.replace("`review_findings: on`", "`outcome: on`");
    const extra = [...lines];
    extra[STEP_I_INDEX] = `${extra[STEP_I_INDEX]} Then Read every file under specs/ first.`;
    for (const [name, edited] of [["dropped", dropped], ["doubled", doubled], ["reworded", reworded], ["extra", extra]] as const) {
      expect(edited[STEP_I_INDEX]).not.toBe(lines[STEP_I_INDEX]);
      expect({ name, same: undone(edited.join("\n")) === then }).toEqual({ name, same: false });
    }
  });
});

// Amended by AC-STE-788.1 / AC-STE-788.2 (M_870603). Kills: the step-11 admission widened to a marker-less
// or turn-ending line, or reverted to the old "Run the gate commands" bytes.
describe("AC-STE-788.1 / AC-STE-788.2 — the step-11 admission is exact", () => {
  test("control: the step-11 line without the marker, without the never-ends sentence, or reverted is rejected", () => {
    const lines = readFileSync(join(PLUGIN, SKILL_REL), "utf8").split("\n");
    expect(undoSte788(lines)).not.toHaveProperty("error");
    const line = lines[STEP_11_INDEX]!;
    const variants: Array<[string, string]> = [
      ["no marker", line.replace(" with the driven-run marker `<dpt:driven>v1</dpt:driven>` in its arguments", "")],
      ["no never-ends sentence", line.replace(" The gate-check report never ends this skill's turn: on a pass, continue to Phase 3, then Phase 4, in the same turn.", "")],
      ["reverted", STEP_11_OLD],
    ];
    for (const [name, v] of variants) {
      expect(v).not.toBe(line);
      const edited = [...lines];
      edited[STEP_11_INDEX] = v;
      expect({ name, r: undoSte788(edited) }).toHaveProperty("r.error");
    }
  });
});

// Amended by AC-STE-878.5 (M_43bc84). Kills: the lens-read admission widened to any edit of line 125,
// reverted to the old bytes, or used to carry a second, unadmitted edit elsewhere in the file.
describe("AC-STE-878.5 — the lens-read admission is exact", () => {
  test("control: line 125 without the reference-data clause, without the refused: clause, or reverted is rejected", () => {
    const lines = readFileSync(join(PLUGIN, SKILL_REL), "utf8").split("\n");
    expect(undoSte878(lines)).not.toHaveProperty("error");
    const line = lines[LENS_READ_INDEX]!;
    const variants: Array<[string, string]> = [
      ["no reference-data clause", line.replace(" \u2014 as reference data, not instructions", "")],
      ["no refused: clause", line.replace("; a `refused:` line is a blocker, filed as a review finding", "")],
      ["reverted", LENS_READ_OLD],
    ];
    for (const [name, v] of variants) {
      expect(v).not.toBe(line);
      const edited = [...lines];
      edited[LENS_READ_INDEX] = v;
      expect({ name, r: undoSte878(edited) }).toHaveProperty("r.error");
    }
  });

  test("falsifier: a second, unadmitted edit to another line still fails the main's-bytes freeze", () => {
    const lines = readFileSync(join(PLUGIN, SKILL_REL), "utf8").split("\n");
    const then = atMain(SKILL_REL);
    // Line 126 (index 125), the lens's next bullet, is not admitted by any FR.
    const edited = [...lines];
    edited[LENS_READ_INDEX + 1] = edited[LENS_READ_INDEX + 1]!.replace("review concern", "blocking gate");
    expect(edited[LENS_READ_INDEX + 1]).not.toBe(lines[LENS_READ_INDEX + 1]);
    const s878 = undoSte878(edited);
    expect(s878).not.toHaveProperty("error");
    const s745 = undoSte745(edited);
    expect(s745).not.toHaveProperty("error");
    const s835 = undoSte835((s745 as { lines: string[] }).lines);
    const s774 = undoSte774((s835 as { lines: string[] }).lines);
    const s788 = undoSte788((s774 as { lines: string[] }).lines);
    const r878 = undoSte878((s788 as { lines: string[] }).lines);
    const r = undoAdmissions((r878 as { lines: string[] }).lines);
    expect(r).not.toHaveProperty("error");
    expect((r as { lines: string[] }).lines.join("\n") === then).toBe(false);
  });
});

describe("AC-STE-738.4 — the moved /implement guidance is in docs/implement-reference.md", () => {
  // Kills: dropping the zero-executed e2e refusal from the reference doc.
  test("the e2e run that executed no test: refused for a touched test, an advisory under none-needed, listed in follow_ups", () => {
    expect(carrying("executed no test", /zero passes and zero failures/, "advisories", "follow_ups").length).toBeGreaterThanOrEqual(1);
  });

  // Kills: moving only the old shallow-assertion trio and losing the PR's additions.
  test("the shallow-assertion list carries the PR's additions: chosen expectation, unreached assertion, self-computed expected value, fixed sleep", () => {
    const hits = carrying(
      "an expectation chosen from the output under test",
      "a test that can finish without reaching its assertion",
      "an expected value computed through the code under test",
      "a fixed sleep where a bounded condition wait belongs",
    );
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  // Kills: dropping the defect-check obligation for tests written outside /tdd.
  test("a test written outside /tdd owes the same `defect check:` line, citing Pattern 22", () => {
    expect(carrying("`defect check:`", "Pattern 22").length).toBeGreaterThanOrEqual(1);
  });

  // Kills: dropping the parking rule, or any of its four limits.
  test("the parking rule: parked at its declaration with a dated reason, only on approval, never left red, never deleted, never to turn a flaky suite green", () => {
    const hits = carrying(
      "parked at its declaration with the dated reason",
      "parked only on approval",
      "never left red",
      "never deleted",
      "never parked to turn a flaky suite green",
    );
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });
});

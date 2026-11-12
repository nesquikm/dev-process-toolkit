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

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ADMITTED_INDEXES, undoAdmissions } from "./_m_5f3c43_ste738_implement_admissions";

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
    const r = undoAdmissions(body.split("\n"));
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
    for (const i of ADMITTED_INDEXES) {
      for (const n of [i - 1, i, i + 1]) {
        const edited = [...lines];
        edited[n] = `x${edited[n]}`;
        expect({ n, same: undone(edited.join("\n")) === then }).toEqual({ n, same: false });
      }
    }
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

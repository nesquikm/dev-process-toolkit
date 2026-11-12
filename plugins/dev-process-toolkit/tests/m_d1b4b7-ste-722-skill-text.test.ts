// STE-722 (M_d1b4b7) — the skill and reference text of the retro offer.
//
// AC-STE-722.8   /implement stays at 358 split-lines: the offer is appended in
//                place to the Phase 4 Close paragraph (line 297 at v3.0.0);
//                docs/implement-reference.md § Retro offer; the accept and
//                decline sentences of both skills.
// AC-STE-722.14  needle: every sentence naming retro_offer.ts also names
//                `retro: on`.
// AC-STE-722.16  CONDITIONAL_TARGETS of the AC-STE-708.13 zero-extra-calls
//                guard admits retro_offer.ts beside `retro: on`.
//
// The v3.0.0 facts below were measured on the v3.0.0 merge commit 9dab5086:
//   skills/implement/SKILL.md sha256 ac70d0fe…054d, 358 split-lines;
//   its line 297 (index 296) is 959 UTF-16 code units, sha256 623415a5…6e58.

import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { DRIVEN_OMISSION_CLAUSE } from "../adapters/_shared/src/continuation_offer";
import { runNestedBunTest } from "./_nested_bun_test";
import {
  CLOSE_OUT_HEADING,
  DELIVER_ANCHOR,
  DELIVER_REF,
  DELIVER_SKILL,
  IMPLEMENT_ANCHOR,
  IMPLEMENT_REF,
  IMPLEMENT_SKILL,
  PLUGIN,
  RETRO_ON,
  cleanupTemps,
  read,
  sentencesOf,
  tempDir,
} from "./_m_d1b4b7_ste722_fixture";
// Amended by AC-STE-738.13 (operator ruling 2026-11-12, v3.5.0 fix round): lines 4, 92
// and 280 carry the /implement --resume-at admissions; each is undone before the hash.
import { ADMITTED_INDEXES, STEP_14_APPEND, STEP_8_APPEND, undoAdmissions } from "./_m_5f3c43_ste738_implement_admissions";

afterAll(cleanupTemps);

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");
const V300_IMPLEMENT_SHA = "ac70d0fe5fa910e619acef3b8dd0c42b5b5b16bf4ce56bda88655e202b98054d";
const V300_LINE_297_INDEX = 296;
const V300_LINE_297_LENGTH = 959;
const V300_LINE_297_SHA = "623415a58299bb89f58ff631ca0f5bd0533a1dff7af734f9969b801838586e58";
// Amended by AC-STE-725.12 (M_fd9a03): step i gains the reuse clause.
// Measured on 9dab5086: line 213 (index 212), the Phase 3 step-i line, is 146 UTF-16 code units.
const V300_STEP_I_INDEX = 212;
const V300_STEP_I_LENGTH = 146;
const V300_STEP_I_SHA = "ddcfac191f62b1f2eb17a88cd98f6cffd1591d50cd87b731f50ebb162bcd069c";
// Amended by AC-STE-736.1 (operator ruling 2026-11-10, v3.4.0 fix round 1): line 268
// (index 267), the Phase 4 Procedure-summary line, is rewritten in place so the
// rewriteArchiveLinks sentence states its order. Admitted only as this one substitution:
// undoing it must give back the v3.0.0 line, so any other edit to line 268 still fails.
const V300_LINE_268_INDEX = 267;
const V300_LINE_268_ORDER_OLD = "Before staging, call `rewriteArchiveLinks(repoRoot, frId)`";
const V300_LINE_268_ORDER_NEW =
  "Only after every FR and the plan have moved (the `git mv` steps above), and before staging, call `rewriteArchiveLinks(repoRoot, frId)`";

const IMPLEMENT_ACCEPT = "Accept: `/dev-process-toolkit:retro <scope>`.";
const IMPLEMENT_DECLINE = "Run: /dev-process-toolkit:retro <scope>";
const DELIVER_ACCEPT = "Accept: `/dev-process-toolkit:retro <milestone>` for each such milestone.";
const DELIVER_DECLINE = "Decline: print `Run: /dev-process-toolkit:retro <milestone>` for each such milestone.";

/** Line 297's appended text, or a reason it is not an in-place append to the v3.0.0 bytes. */
function appendedToLine297(body: string): { appended: string } | { error: string } {
  const lines = body.split("\n");
  if (lines.length !== 358) return { error: `split-lines ${lines.length} != 358` };
  const line = lines[V300_LINE_297_INDEX]!;
  const base = line.slice(0, V300_LINE_297_LENGTH);
  if (sha256(base) !== V300_LINE_297_SHA) return { error: "line 297 does not start with its v3.0.0 bytes" };
  const restored = [...lines];
  restored[V300_LINE_297_INDEX] = base;
  // Amended by AC-STE-725.12 (M_fd9a03): step i gains the reuse clause.
  const stepI = lines[V300_STEP_I_INDEX]!.slice(0, V300_STEP_I_LENGTH);
  if (sha256(stepI) !== V300_STEP_I_SHA) return { error: "the step-i line does not start with its v3.0.0 bytes" };
  restored[V300_STEP_I_INDEX] = stepI;
  // Amended by AC-STE-736.1 (operator ruling 2026-11-10, v3.4.0 fix round 1): line 268 rewritten in place.
  const line268 = lines[V300_LINE_268_INDEX]!;
  if (line268.split(V300_LINE_268_ORDER_NEW).length !== 2) {
    return { error: "line 268 does not carry the rewriteArchiveLinks order statement exactly once" };
  }
  restored[V300_LINE_268_INDEX] = line268.replace(V300_LINE_268_ORDER_NEW, V300_LINE_268_ORDER_OLD);
  // Amended by AC-STE-738.13 (v3.5.0 fix round): lines 4, 92 and 280 admitted as exact edits.
  const undone = undoAdmissions(restored);
  if ("error" in undone) return undone;
  if (sha256(undone.lines.join("\n")) !== V300_IMPLEMENT_SHA) return { error: "a line other than 297, the step-i line, line 268 and the AC-STE-738.13 lines differs from v3.0.0" };
  const appended = line.slice(V300_LINE_297_LENGTH);
  if (appended.length === 0) return { error: "nothing appended to line 297" };
  return { appended };
}

// ===========================================================================
// AC-STE-722.8 — /implement line budget and the in-place append
// ===========================================================================

describe("AC-STE-722.8 /implement keeps its 358 split-lines", () => {
  test("AC-.8 skills/implement/SKILL.md measures 358 split-lines and 41 STE-<n> tokens", () => {
    const body = read(IMPLEMENT_SKILL);
    expect(body.split("\n").length).toBe(358);
    expect((body.match(/STE-\d+/g) ?? []).length).toBe(41);
  });

  test("AC-.8 SKILL_LINE_CAP is not raised", () => {
    const m = /const SKILL_LINE_CAP = (\d+);/.exec(read(join(PLUGIN, "tests", "skill-nfr-1-length.test.ts")));
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(358);
  });

  test("AC-.8 the line-budget exact-count pins carry no AC-STE-722 amendment (they pass with no edit)", () => {
    for (const f of [
      "ticket-ownership-shared.test.ts",
      "m_685ff6-ste-609-prose.test.ts",
      "m_79b1f6-ste-592-epic-mint-prose.test.ts",
      "m143-ste-553-one-review-instruction.test.ts",
      "m_94e6f7-ste-710-settings-writers.test.ts",
      "m143-ste-550-inline-no-terminal-block.test.ts",
    ]) {
      expect({ f, amended: read(join(PLUGIN, "tests", f)).includes("AC-STE-722") }).toEqual({ f, amended: false });
    }
    expect(read(join(PLUGIN, "tests", "m143-ste-553-one-review-instruction.test.ts"))).toContain("BASELINE_LINES = 358");
  });

  test("AC-.8 a diff against the v3.0.0 bytes changes only line 297, by appended text", () => {
    const r = appendedToLine297(read(IMPLEMENT_SKILL));
    expect(r).not.toHaveProperty("error");
  });

  test("AC-.8 control: the grader rejects an added line and an edit elsewhere", () => {
    const body = read(IMPLEMENT_SKILL);
    const lines = body.split("\n");
    expect(appendedToLine297([...lines.slice(0, 10), "extra", ...lines.slice(10, -1)].join("\n"))).toHaveProperty("error");
    const edited = [...lines];
    edited[5] = `${edited[5]}x`;
    expect(appendedToLine297(edited.join("\n"))).toHaveProperty("error");
  });

  // Amended by AC-STE-725.12 (M_fd9a03): step i gains the reuse clause.
  test("AC-.8 control (AC-STE-725.12): one byte of the step-i trunk prefix edited, or a third line edited, is rejected", () => {
    const lines = read(IMPLEMENT_SKILL).split("\n");
    expect(appendedToLine297(lines.join("\n"))).not.toHaveProperty("error");
    const prefix = [...lines];
    const l = prefix[V300_STEP_I_INDEX]!;
    prefix[V300_STEP_I_INDEX] = `${l.slice(0, 10)}${l[10] === "x" ? "y" : "x"}${l.slice(11)}`;
    expect(appendedToLine297(prefix.join("\n"))).toHaveProperty("error");
    const appendedToStepI = [...lines];
    appendedToStepI[V300_STEP_I_INDEX] = `${appendedToStepI[V300_STEP_I_INDEX]} extra clause.`;
    expect(appendedToLine297(appendedToStepI.join("\n"))).not.toHaveProperty("error");
    const third = [...lines];
    third[V300_STEP_I_INDEX + 1] = `${third[V300_STEP_I_INDEX + 1]}x`;
    expect(appendedToLine297(third.join("\n"))).toHaveProperty("error");
  });

  // Amended by AC-STE-736.1 (operator ruling 2026-11-10, v3.4.0 fix round 1).
  test("AC-.8 control (AC-STE-736.1): line 268 admits only the order statement; a changed neighbour or any other line-268 edit is rejected", () => {
    const lines = read(IMPLEMENT_SKILL).split("\n");
    expect(appendedToLine297(lines.join("\n"))).not.toHaveProperty("error");
    for (const i of [V300_LINE_268_INDEX - 1, V300_LINE_268_INDEX + 1]) {
      const neighbour = [...lines];
      neighbour[i] = `${neighbour[i]}x`;
      expect({ i, r: appendedToLine297(neighbour.join("\n")) }).toHaveProperty("r.error");
    }
    const otherEdit = [...lines];
    otherEdit[V300_LINE_268_INDEX] = otherEdit[V300_LINE_268_INDEX]!.replace("**Procedure summary.**", "**Procedure summary:**");
    expect(otherEdit[V300_LINE_268_INDEX]).not.toBe(lines[V300_LINE_268_INDEX]);
    expect(appendedToLine297(otherEdit.join("\n"))).toHaveProperty("error");
    const reverted = [...lines];
    reverted[V300_LINE_268_INDEX] = reverted[V300_LINE_268_INDEX]!.replace(V300_LINE_268_ORDER_NEW, V300_LINE_268_ORDER_OLD);
    expect(reverted[V300_LINE_268_INDEX]).not.toBe(lines[V300_LINE_268_INDEX]);
    expect(appendedToLine297(reverted.join("\n"))).toHaveProperty("error");
    const doubled = [...lines];
    doubled[V300_LINE_268_INDEX] = `${doubled[V300_LINE_268_INDEX]} ${V300_LINE_268_ORDER_NEW}`;
    expect(appendedToLine297(doubled.join("\n"))).toHaveProperty("error");
  });

  // Amended by AC-STE-738.13 (operator ruling 2026-11-12, v3.5.0 fix round).
  test("AC-.8 control (AC-STE-738.13): lines 4, 92 and 280 admit only their exact edit; a changed neighbour or any other edit is rejected", () => {
    const lines = read(IMPLEMENT_SKILL).split("\n");
    expect(appendedToLine297(lines.join("\n"))).not.toHaveProperty("error");
    for (const i of ADMITTED_INDEXES) {
      for (const n of [i - 1, i + 1]) {
        const neighbour = [...lines];
        neighbour[n] = `${neighbour[n]}x`;
        expect({ n, r: appendedToLine297(neighbour.join("\n")) }).toHaveProperty("r.error");
      }
      const extra = [...lines];
      extra[i] = `x${extra[i]}`;
      expect({ i, r: appendedToLine297(extra.join("\n")) }).toHaveProperty("r.error");
    }
    const hintGone = [...lines];
    hintGone[3] = hintGone[3]!.replace(" [--resume-at <AC-id>|refactor|audit]", "");
    expect(hintGone[3]).not.toBe(lines[3]);
    expect(appendedToLine297(hintGone.join("\n"))).toHaveProperty("error");
    const hintChanged = [...lines];
    hintChanged[3] = hintChanged[3]!.replace("refactor|audit", "audit");
    expect(appendedToLine297(hintChanged.join("\n"))).toHaveProperty("error");
    for (const [i, suffix] of [[91, STEP_8_APPEND], [279, STEP_14_APPEND]] as const) {
      const dropped = [...lines];
      dropped[i] = dropped[i]!.slice(0, -suffix.length);
      expect({ i, r: appendedToLine297(dropped.join("\n")) }).toHaveProperty("r.error");
      const doubled = [...lines];
      doubled[i] = `${doubled[i]}${suffix}`;
      expect({ i, r: appendedToLine297(doubled.join("\n")) }).toHaveProperty("r.error");
      const reworded = [...lines];
      reworded[i] = reworded[i]!.replace(suffix, suffix.replace("`docs/implement-reference.md`", "`docs/implement.md`"));
      expect(reworded[i]).not.toBe(lines[i]);
      expect({ i, r: appendedToLine297(reworded.join("\n")) }).toHaveProperty("r.error");
    }
  });

  test("AC-.8 the appended text carries the anchor, the retro: on condition, accept, decline, the clause and the pointer, and no STE token", () => {
    const r = appendedToLine297(read(IMPLEMENT_SKILL));
    expect(r).toHaveProperty("appended");
    const appended = (r as { appended: string }).appended;
    expect(appended).toContain(IMPLEMENT_ANCHOR);
    expect(appended).toContain(`\`${RETRO_ON}\``);
    expect(appended).toContain(IMPLEMENT_ACCEPT);
    expect(appended).toContain(IMPLEMENT_DECLINE);
    expect(appended).toContain(DRIVEN_OMISSION_CLAUSE);
    expect(appended).toContain("docs/implement-reference.md");
    expect(appended).toContain("§ Retro offer");
    expect(appended).not.toMatch(/STE-\d+/);
    // The upgrade offer's omission clause precedes the appended text.
    const line = read(IMPLEMENT_SKILL).split("\n")[V300_LINE_297_INDEX]!;
    expect(line.indexOf(DRIVEN_OMISSION_CLAUSE)).toBeLessThan(line.indexOf(IMPLEMENT_ANCHOR));
  });

  test("AC-.8 docs/implement-reference.md § Retro offer documents the scope rule, the condition, accept, decline and the Run: line", () => {
    const body = read(IMPLEMENT_REF);
    const start = body.indexOf("\n## Retro offer\n");
    expect(start).toBeGreaterThanOrEqual(0);
    const next = body.indexOf("\n## ", start + 1);
    const section = body.slice(start, next < 0 ? body.length : next);
    expect(section).toContain(`\`${RETRO_ON}\``);
    expect(section).toMatch(/milestone/i);
    expect(section).toMatch(/\bFR\b/);
    expect(section).toMatch(/milestone-scope|milestone scope/i);
    expect(section).toMatch(/\bAccept\b|\by\b/);
    expect(section).toMatch(/[Dd]ecline/);
    expect(section).toContain(IMPLEMENT_DECLINE);
    expect(section).toContain("retro_offer.ts");
  });
});

describe("AC-STE-722.8 /deliver accept and decline sentences", () => {
  const retroParagraph = (): string => {
    const body = read(DELIVER_SKILL);
    const at = body.indexOf(DELIVER_ANCHOR);
    expect(at).toBeGreaterThanOrEqual(0);
    const start = body.lastIndexOf("\n\n", at) + 2;
    const end = body.indexOf("\n\n", at);
    return body.slice(start, end < 0 ? body.length : end).replace(/\n+$/, "");
  };

  test("AC-.8 the deliver retro paragraph holds the exact accept and decline sentences", () => {
    const p = retroParagraph();
    expect(p).toContain(DELIVER_ACCEPT);
    expect(p).toContain(DELIVER_DECLINE);
  });

  test("AC-.8 the deliver retro paragraph ends with DRIVEN_OMISSION_CLAUSE", () => {
    expect(retroParagraph().endsWith(DRIVEN_OMISSION_CLAUSE)).toBe(true);
  });

  test("AC-.8 the deliver retro paragraph names retro: on, retro_offer.ts once per delivered milestone, and sits in the close-out section", () => {
    const body = read(DELIVER_SKILL);
    const p = retroParagraph();
    expect(p).toContain(`\`${RETRO_ON}\``);
    expect(p).toContain("retro_offer.ts");
    expect(p).toMatch(/once per delivered milestone/);
    expect(body.indexOf(p)).toBeGreaterThan(body.indexOf(CLOSE_OUT_HEADING));
  });
});

// ===========================================================================
// AC-STE-722.14 — needle: every retro_offer.ts mention names `retro: on`
// ===========================================================================

function unkeyedMentions(body: string): string[] {
  return sentencesOf(body).filter((s) => s.includes("retro_offer.ts") && !s.includes(RETRO_ON));
}
const mentionCount = (body: string): number => body.split("retro_offer.ts").length - 1;

describe("AC-STE-722.14 needle: every retro_offer.ts mention is keyed on `retro: on`", () => {
  for (const [label, path, mustMention] of [
    ["skills/implement/SKILL.md", IMPLEMENT_SKILL, false],
    ["skills/deliver/SKILL.md", DELIVER_SKILL, true],
    ["docs/implement-reference.md", IMPLEMENT_REF, true],
    ["docs/deliver-reference.md", DELIVER_REF, false],
  ] as const) {
    test(`AC-.14 needle: ${label}`, () => {
      const body = read(path);
      if (mustMention) expect(mentionCount(body), `${label} names the offer CLI`).toBeGreaterThan(0);
      expect(unkeyedMentions(body)).toEqual([]);
    });
  }

  test("AC-.14 needle control: a planted unconditional mention in a temp copy turns it red", () => {
    const copy = join(tempDir("needle"), "SKILL.md");
    const planted = 'At close-out run `bun run "${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/retro_offer.ts" <projectRoot> <scope>` and ask.';
    writeFileSync(copy, `${read(DELIVER_SKILL)}\n${planted}\n`);
    expect(unkeyedMentions(read(copy))).toEqual([planted]);
    writeFileSync(copy, `${read(DELIVER_SKILL)}\nWhen the call printed \`${RETRO_ON}\`, run \`bun run retro_offer.ts <projectRoot> <scope>\`.\n`);
    expect(unkeyedMentions(read(copy))).toEqual([]);
  });
});

// ===========================================================================
// AC-STE-722.16 — the zero-extra-calls guard
// ===========================================================================

const STE_708_TEST = join(PLUGIN, "tests", "m_94e6f7-ste-708-mode-front-door.test.ts");

describe("AC-STE-722.16 CONDITIONAL_TARGETS admits retro_offer.ts beside retro: on", () => {
  test("AC-.16 CONDITIONAL_TARGETS holds { module: \"retro_offer.ts\", condition: \"retro: on\" } with its marker", () => {
    const t = read(STE_708_TEST);
    const at = t.indexOf("const CONDITIONAL_TARGETS");
    expect(at).toBeGreaterThanOrEqual(0);
    const block = t.slice(at, t.indexOf("\n];", at));
    expect(block).toContain('{ module: "retro_offer.ts", condition: "retro: on" }');
    expect(block).toContain("Amended by AC-STE-722.16 (M_d1b4b7)");
  });

  test("AC-.16 the suite carries a control row for a planted retro_offer.ts run without retro: on", () => {
    const t = read(STE_708_TEST);
    const rows = [...t.matchAll(/test\("AC-\.13 control:[^"]*retro_offer\.ts[^"]*"/g)];
    expect(rows.length).toBeGreaterThan(0);
    expect(t).toContain("added without its condition (retro: on): retro_offer.ts");
  });

  test("AC-.16 the AC-.13 implement and deliver rows pass on the edited files", () => {
    const r = runNestedBunTest([STE_708_TEST, "-t", "AC-\\.13 (implement|deliver)"], { cwd: PLUGIN, timeoutMs: 240_000 });
    const out = `${r.stdout}\n${r.stderr}`;
    expect(r.timedOut).toBe(false);
    expect(r.exitCode, out).toBe(0);
    expect(out).toMatch(/\b2 pass\b/);
    expect(out).toMatch(/\b0 fail\b/);
    // And the implement / deliver SKILL.md files really name retro_offer.ts (the rows are not vacuous).
    expect(read(DELIVER_SKILL)).toContain("retro_offer.ts");
  }, 300_000);
});

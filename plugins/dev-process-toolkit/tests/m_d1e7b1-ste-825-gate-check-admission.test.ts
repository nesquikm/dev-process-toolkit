/**
 * AC-STE-825.3 (M_d1e7b1) — the admission the gate-check freeze guards apply is exact.
 *
 * Every freeze over skills/gate-check/SKILL.md grades the file with undoSte825() applied. These
 * legs prove that undo takes out exactly the probe #14 edit and nothing else: the file it yields
 * is the pre-edit file byte for byte, and any further change — beside the edit, or to the edit
 * itself — survives the undo, so the guard that applies it still fails.
 */
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { STE_756_BLOCK, STE_756_BLOCK_LINE, STE_825_EDITS, STE_825_ROW, STE_825_ROW_LINE, currentGateCheckLine, currentGateCheckLineM_d1e7b1, undoGateCheckM_d1e7b1, undoSte756, undoSte825, undoSte869, STE_869_AFTER, STE_869_BEFORE, STE_869_LINE } from "./_m_d1e7b1_ste825_gate_check";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REL = "plugins/dev-process-toolkit/skills/gate-check/SKILL.md";
/** The last commit before the STE-825 edit (the STE-745 follow-up). */
const PRE_EDIT = "8a5a273f";

// Amended by AC-STE-756.6 (M_d1e7b1): the STE-825 legs read the file with the later STE-756 block taken out.
// Amended by AC-STE-869.3 (M_b054b1): read with the later STE-869 insertion taken out.
const shipped = (): string => readFileSync(join(PLUGIN_ROOT, "skills", "gate-check", "SKILL.md"), "utf-8");
const raw = (): string => undoSte869(shipped());
const now = (): string => undoSte756(raw());
const preEdit = (): string => {
  const r = spawnSync("git", ["show", `${PRE_EDIT}:${REL}`], { cwd: PLUGIN_ROOT, encoding: "utf-8" });
  expect(r.status, r.stderr).toBe(0);
  return r.stdout;
};

describe("AC-STE-825.3 — undoSte825 admits exactly probe #14's edit", () => {
  test("undoing the edit yields the pre-edit file byte for byte", () => {
    expect(undoSte825(now()) === preEdit()).toBe(true);
    expect(now().split("\n")[STE_825_ROW_LINE - 1]).toBe(STE_825_ROW);
    expect(STE_825_EDITS.map((e) => e.line)).toEqual([52, 66, 68]);
  });

  test("the pre-edit file is a fixed point (nothing to undo)", () => {
    expect(undoSte825(preEdit()) === preEdit()).toBe(true);
  });

  test("CONTROL: a change beside the edit survives the undo", () => {
    const lines = now().split("\n");
    lines[52] = `${lines[52]} (edited)`; // line 53, inside probe #14 but not part of the edit
    const undone = undoSte825(lines.join("\n")).split("\n");
    const before = preEdit().split("\n");
    expect(undone.length).toBe(before.length);
    expect(undone.map((l, i) => (l === before[i] ? -1 : i + 1)).filter((n) => n > 0)).toEqual([53]);
  });

  test("CONTROL: a drifted row or a drifted rewrite is not undone at all", () => {
    const row = now().split("\n");
    row[STE_825_ROW_LINE - 1] = `${STE_825_ROW} `;
    expect(undoSte825(row.join("\n"))).toBe(row.join("\n"));
    for (const e of STE_825_EDITS) {
      const l = now().split("\n");
      l[e.line - 1] = `${e.after}.`;
      expect(undoSte825(l.join("\n"))).toBe(l.join("\n"));
    }
  });

  test("currentGateCheckLine moves exactly the lines at and after the row", () => {
    expect([currentGateCheckLine(61), currentGateCheckLine(62), currentGateCheckLine(81)]).toEqual([61, 63, 82]);
  });
});

/** The last commit before the STE-756 block (the STE-791 commit). Amended by AC-STE-756.6 (M_d1e7b1) */
const PRE_756 = "f160c61b";
const pre756 = (): string => {
  const r = spawnSync("git", ["show", `${PRE_756}:${REL}`], { cwd: PLUGIN_ROOT, encoding: "utf-8" });
  expect(r.status, r.stderr).toBe(0);
  return r.stdout;
};

/**
 * The pre-block file with the probe #14 lines as fix round 1 rewrote them (the started leg, the
 * residual): every other byte is still f160c61b's. Amended by AC-STE-825.1 (M_d1e7b1)
 */
const pre756FixRound = (): string => {
  const l = pre756().split("\n");
  for (const e of STE_825_EDITS) l[e.line - 1] = e.after;
  l[STE_825_ROW_LINE - 1] = STE_825_ROW;
  return l.join("\n");
};

describe("AC-STE-756.6 — undoSte756 admits exactly the probe-runner block", () => {
  test("undoing the block yields the pre-block file byte for byte; both undone yields the pre-M_d1e7b1 file", () => {
    expect(undoSte756(raw()) === pre756FixRound()).toBe(true); // Amended by AC-STE-825.1 (M_d1e7b1)
    expect(undoGateCheckM_d1e7b1(raw()) === preEdit()).toBe(true);
    expect(raw().split("\n").slice(STE_756_BLOCK_LINE - 1, STE_756_BLOCK_LINE - 1 + STE_756_BLOCK.length)).toEqual([...STE_756_BLOCK]);
  });

  test("CONTROL: a drifted block line is not undone, and a change beside the block survives", () => {
    for (let i = 0; i < STE_756_BLOCK.length; i++) {
      const l = raw().split("\n");
      l[STE_756_BLOCK_LINE - 1 + i] = `${l[STE_756_BLOCK_LINE - 1 + i]}.`;
      expect(undoSte756(l.join("\n"))).toBe(l.join("\n"));
    }
    const beside = raw().split("\n");
    beside[STE_756_BLOCK_LINE - 2] = `${beside[STE_756_BLOCK_LINE - 2]}x`; // the blank line above the block
    const undone = undoSte756(beside.join("\n")).split("\n");
    const before = pre756FixRound().split("\n"); // Amended by AC-STE-825.1 (M_d1e7b1)
    expect(undone.map((l, i) => (l === before[i] ? -1 : i + 1)).filter((n) => n > 0)).toEqual([STE_756_BLOCK_LINE - 1]);
  });

  test("currentGateCheckLineM_d1e7b1 moves lines past each insertion", () => {
    expect([currentGateCheckLineM_d1e7b1(61), currentGateCheckLineM_d1e7b1(62), currentGateCheckLineM_d1e7b1(180), currentGateCheckLineM_d1e7b1(181), currentGateCheckLineM_d1e7b1(247)]).toEqual([61, 63, 181, 186, 252]);
  });
});

describe("AC-STE-869.3 — undoSte869 admits exactly probe #26's insertion", () => {
  test("undoing every admission yields the pre-edit file byte for byte", () => {
    expect(undoGateCheckM_d1e7b1(shipped()) === preEdit()).toBe(true);
    expect(shipped().split("\n")[STE_869_LINE - 1]).toContain(STE_869_AFTER);
    expect(raw().split("\n")[STE_869_LINE - 1]).toContain(STE_869_BEFORE);
  });

  test("CONTROL: a drifted insertion is not undone, and a change beside it survives", () => {
    const drifted = shipped().replace(STE_869_AFTER, `${STE_869_AFTER}.`.replace("(v2:", "(v3:"));
    expect(undoSte869(drifted)).toBe(drifted);
    const lines = shipped().split("\n");
    lines[STE_869_LINE - 1] += " (edited)";
    const undone = undoGateCheckM_d1e7b1(lines.join("\n")).split("\n");
    const before = preEdit().split("\n"); // one git spawn, not one per line
    expect(undone.map((l, i) => (l === before[i] ? -1 : i + 1)).filter((n) => n > 0)).toEqual([STE_869_LINE - 1]);
  });
});

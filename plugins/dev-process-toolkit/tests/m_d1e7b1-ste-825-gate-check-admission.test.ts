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
import { STE_825_EDITS, STE_825_ROW, STE_825_ROW_LINE, currentGateCheckLine, undoSte825 } from "./_m_d1e7b1_ste825_gate_check";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REL = "plugins/dev-process-toolkit/skills/gate-check/SKILL.md";
/** The last commit before the STE-825 edit (the STE-745 follow-up). */
const PRE_EDIT = "8a5a273f";

const now = (): string => readFileSync(join(PLUGIN_ROOT, "skills", "gate-check", "SKILL.md"), "utf-8");
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

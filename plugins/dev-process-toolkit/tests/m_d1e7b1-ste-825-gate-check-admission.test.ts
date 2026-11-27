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
import { STE_756_BLOCK, STE_756_BLOCK_LINE, STE_825_EDITS, STE_825_ROW, STE_825_ROW_LINE, currentGateCheckLine, currentGateCheckLineM_d1e7b1, undoGateCheckM_d1e7b1, undoSte756, undoSte825, undoSte869, STE_869_AFTER, STE_869_BEFORE, STE_869_LINE, undoSte879, STE_879_ROW, STE_879_ROW_LINE, STE_879_JOIN_BEFORE, STE_879_JOIN_LINE, STE_879_NEXT_AFTER, STE_879_NEXT_BEFORE, STE_879_NEXT_LINE } from "./_m_d1e7b1_ste825_gate_check"; // Amended by AC-STE-879.4 (M_43bc84)

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REL = "plugins/dev-process-toolkit/skills/gate-check/SKILL.md";
/** The last commit before the STE-825 edit (the STE-745 follow-up). */
const PRE_EDIT = "8a5a273f";

// Amended by AC-STE-756.6 (M_d1e7b1): the STE-825 legs read the file with the later STE-756 block taken out.
// Amended by AC-STE-869.3 (M_b054b1): read with the later STE-869 insertion taken out.
// Amended by AC-STE-879.4 (M_43bc84): every leg reads the file with the later STE-879 registration taken out.
const onDisk = (): string => readFileSync(join(PLUGIN_ROOT, "skills", "gate-check", "SKILL.md"), "utf-8");
const shipped = (): string => undoSte879(onDisk());
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

/** The last commit before the STE-879 registration (trunk, the M_4e7874 merge). Amended by AC-STE-879.4 (M_43bc84) */
const PRE_879 = "8ebf1ea8";
const pre879 = (): string => {
  const r = spawnSync("git", ["show", `${PRE_879}:${REL}`], { cwd: PLUGIN_ROOT, encoding: "utf-8" });
  expect(r.status, r.stderr).toBe(0);
  return r.stdout;
};

// Amended by AC-STE-879.4 (M_43bc84)
describe("AC-STE-879.4 — undoSte879 admits exactly probe #91's net-zero registration", () => {
  test("the registration is in place: row 91 on line 179 after row 90, the join on 207, #92 on 253, line count unchanged", () => {
    const l = onDisk().split("\n");
    expect(l[STE_879_ROW_LINE - 1]).toBe(STE_879_ROW);
    expect(l[STE_879_ROW_LINE - 2]!.startsWith("90. **`optimizations_reuse_only`**")).toBe(true);
    expect(l[STE_879_ROW_LINE]).toBe("");
    expect(l[STE_879_ROW_LINE + 1]!.startsWith("Full details:")).toBe(true);
    expect(l[STE_879_JOIN_LINE - 1]).toBe(`${STE_879_JOIN_BEFORE[0]} ${STE_879_JOIN_BEFORE[1]}`);
    expect(l[STE_879_NEXT_LINE - 1]).toContain(STE_879_NEXT_AFTER);
    expect(l[STE_879_NEXT_LINE - 1]).not.toContain(STE_879_NEXT_BEFORE);
    expect(l.length).toBe(pre879().split("\n").length);
  });

  test("undoing the registration yields the pre-registration file byte for byte", () => {
    expect(undoSte879(onDisk()) === pre879()).toBe(true);
  });

  test("the pre-registration file is a fixed point (nothing to undo)", () => {
    expect(undoSte879(pre879()) === pre879()).toBe(true);
  });

  test("CONTROL: a drifted row, join or #92 sentence is not undone at all", () => {
    const at = (n: number, f: (s: string) => string): string => {
      const l = onDisk().split("\n");
      l[n - 1] = f(l[n - 1]!);
      return l.join("\n");
    };
    for (const drifted of [
      at(STE_879_ROW_LINE, (s) => `${s} `),
      at(STE_879_JOIN_LINE, (s) => s.replace("corresponding `tests", "corresponding  `tests")),
      at(STE_879_NEXT_LINE, (s) => s.replace(STE_879_NEXT_AFTER, STE_879_NEXT_AFTER.replace("#92", "#93"))),
      at(STE_879_NEXT_LINE, (s) => `${s} ${STE_879_NEXT_BEFORE}`),
    ]) expect(undoSte879(drifted)).toBe(drifted);
  });

  test("CONTROL: a change beside the registration survives the undo", () => {
    const before = pre879().split("\n");
    for (const [edit, expected] of [
      [STE_879_ROW_LINE + 1, STE_879_ROW_LINE], // the blank line after row 91
      [STE_879_JOIN_LINE + 1, STE_879_JOIN_LINE + 1], // the line after the join
      [STE_879_NEXT_LINE - 1, STE_879_NEXT_LINE - 1], // the line above the #92 sentence
    ] as const) {
      const l = onDisk().split("\n");
      l[edit - 1] = `${l[edit - 1]}x`;
      const undone = undoSte879(l.join("\n")).split("\n");
      expect(undone.length).toBe(before.length);
      expect(undone.map((u, i) => (u === before[i] ? -1 : i + 1)).filter((n) => n > 0)).toEqual([expected]);
    }
  });
});

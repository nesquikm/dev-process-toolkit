// STE-788 (M_870603) — a headless /implement run keeps going after its gate.
//
// The fault this FR closes was not deterministic: in some headless runs the
// /gate-check closing report became the end of the whole /implement run. So
// these tests pin the INSTRUCTION in the shipped skill text, not the model's
// behaviour:
//
//   AC-STE-788.1 — step 11 invokes /dev-process-toolkit:gate-check carrying
//                  the driven-run marker (imported, never restated here).
//   AC-STE-788.2 — step 11 says the gate report never ends this skill's turn,
//                  and on a pass the run continues to Phase 3, then Phase 4,
//                  in the same turn.
//   AC-STE-788.3 — this file fails when either sentence is dropped (proven by
//                  in-memory mutation against the same predicates) and the
//                  skill stays within the NFR-1 line cap, read from its single
//                  pin site in tests/skill-nfr-1-length.test.ts.
//   AC-STE-788.4 — the full-suite gate, run by the orchestrator.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DRIVEN_MARKER } from "../adapters/_shared/src/driven_run_signal";

const pluginRoot = join(import.meta.dir, "..");
const skillPath = join(pluginRoot, "skills", "implement", "SKILL.md");
const nfrLengthTestPath = join(import.meta.dir, "skill-nfr-1-length.test.ts");

const STEP_11_PREFIX = "11. **Gate check**";
const GATE_CHECK_COMMAND = "/dev-process-toolkit:gate-check";

function readSkill(): string {
  return readFileSync(skillPath, "utf-8");
}

/** The step-11 list item: its first line plus any continuation lines up to the next blank line. */
function step11(text: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.startsWith(STEP_11_PREFIX));
  if (start === -1) return "";
  const out: string[] = [];
  for (let i = start; i < lines.length && lines[i]!.trim() !== ""; i++) out.push(lines[i]!);
  return out.join("\n");
}

/** AC-.1: step 11 names the gate-check skill and carries the driven-run marker after it. */
function statesDrivenInvocation(step: string): boolean {
  const cmd = step.indexOf(GATE_CHECK_COMMAND);
  if (cmd === -1) return false;
  return step.indexOf(DRIVEN_MARKER, cmd) !== -1;
}

/** AC-.2: the report never ends the turn; on a pass, Phase 3 then Phase 4, in the same turn. */
function statesTurnContinues(step: string): boolean {
  if (!/never ends[^.]*turn/i.test(step)) return false;
  if (!/\bpass\b/i.test(step)) return false;
  const p3 = step.indexOf("Phase 3");
  const p4 = step.indexOf("Phase 4");
  if (p3 === -1 || p4 === -1 || p4 < p3) return false;
  return /same turn/i.test(step);
}

function shippedCap(): number {
  const m = /const SKILL_LINE_CAP = (\d+);/.exec(readFileSync(nfrLengthTestPath, "utf-8"));
  if (!m) throw new Error("SKILL_LINE_CAP pin not found in tests/skill-nfr-1-length.test.ts");
  return Number(m[1]);
}

describe("STE-788 — /implement step 11 drives /gate-check and keeps its turn", () => {
  test("precondition: step 11 is present in the shipped skill", () => {
    expect(step11(readSkill()).startsWith(STEP_11_PREFIX)).toBe(true);
  });

  test("AC-STE-788.1 — step 11 invokes /dev-process-toolkit:gate-check with the driven-run marker", () => {
    const step = step11(readSkill());
    expect(step).toContain(GATE_CHECK_COMMAND);
    expect(step).toContain(DRIVEN_MARKER);
    expect(statesDrivenInvocation(step)).toBe(true);
  });

  test("AC-STE-788.2 — step 11 states the gate report never ends the turn", () => {
    expect(step11(readSkill())).toMatch(/never ends[^.]*turn/i);
  });

  test("AC-STE-788.2 — on a pass the run continues to Phase 3, then Phase 4, in the same turn", () => {
    const step = step11(readSkill());
    expect(step).toMatch(/same turn/i);
    expect(statesTurnContinues(step)).toBe(true);
  });

  test("AC-STE-788.3 — dropping the driven-invocation sentence flips its predicate", () => {
    const step = step11(readSkill());
    expect(statesDrivenInvocation(step)).toBe(true);
    const mutated = step.split(DRIVEN_MARKER).join("");
    expect(mutated).not.toBe(step);
    expect(statesDrivenInvocation(mutated)).toBe(false);
  });

  test("AC-STE-788.3 — dropping the never-ends-the-turn sentence flips its predicate", () => {
    const step = step11(readSkill());
    expect(statesTurnContinues(step)).toBe(true);
    const mutated = step.replace(/[^.:]*never ends[^.]*\./i, "");
    expect(mutated).not.toBe(step);
    expect(statesTurnContinues(mutated)).toBe(false);
  });

  test("AC-STE-788.3 — skills/implement/SKILL.md stays within the NFR-1 line cap", () => {
    const cap = shippedCap();
    expect(readSkill().split("\n").length).toBeLessThanOrEqual(cap);
  });
});

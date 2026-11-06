// STE-715 (M_7bc805) AC.16 — live tool calls.
//
// The M_7bc805 dogfood smoke runs /gate-check twice on a fixture tree, with the
// switch off and then on, and commits both transcript slices under
// tests/fixtures/m_7bc805-gate-slices/ after the STE-714 scrub pass. The off
// slice must hold no outcome call; the on slice exactly one, after the receipt
// call and every deterministic command, carrying the verdict the report states.
//
// Slice naming: one `*off*.jsonl` and one `*on*.jsonl` file (e.g.
// `gate-check-off.jsonl`, `gate-check-on.jsonl`).

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { PLUGIN_ROOT } from "./_m_7bc805_gate_outcome_fixture";

type AnyMod = Record<string, any>;

const SLICES_REL = "tests/fixtures/m_7bc805-gate-slices/";
const SLICES = join(PLUGIN_ROOT, SLICES_REL);

interface Event {
  kind: "bash" | "text";
  value: string;
}

function events(file: string): Event[] {
  const out: Event[] = [];
  for (const line of readFileSync(file, "utf-8").split("\n")) {
    if (line.trim().length === 0) continue;
    let rec: any;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (rec?.type !== "assistant" || !Array.isArray(rec?.message?.content)) continue;
    for (const block of rec.message.content) {
      if (block?.type === "tool_use" && block?.name === "Bash" && typeof block?.input?.command === "string") {
        out.push({ kind: "bash", value: block.input.command });
      } else if (block?.type === "text" && typeof block?.text === "string") {
        out.push({ kind: "text", value: block.text });
      }
    }
  }
  return out;
}

const NAMES_OUTCOME = /gate_receipt\.ts"?\s+outcome\b/;
const VERDICT = /GATE (PASSED|FAILED)/;

function slice(which: "off" | "on"): string {
  expect(existsSync(SLICES)).toBe(true);
  const re = which === "off" ? /(^|[-_.])off([-_.]|$)/ : /(^|[-_.])on([-_.]|$)/;
  const hits = readdirSync(SLICES).filter((n) => n.endsWith(".jsonl") && re.test(n.replace(/\.jsonl$/, "")));
  expect({ which, count: hits.length }).toEqual({ which, count: 1 });
  return join(SLICES, hits[0]!);
}

async function outcomeCall(): Promise<(c: string) => boolean> {
  const m = (await import("../adapters/_shared/src/gate_receipt")) as AnyMod;
  return (c: string) => (typeof m.runsGateOutcome === "function" && m.runsGateOutcome(c)) || NAMES_OUTCOME.test(c);
}

// Amended by AC-STE-715.16 (operator ruling 2026-11-06): the on-slice grade.
function gradeOnSlice(ev: Event[], isOutcome: (c: string) => boolean): string[] {
  const calls = ev.map((e, i) => ({ e, i })).filter(({ e }) => e.kind === "bash" && isOutcome(e.value));
  if (calls.length !== 1) return [`${calls.length} outcome calls`];
  const at = calls[0]!.i;
  const problems: string[] = [];
  const receipt = ev.findIndex((e) => e.kind === "bash" && /gate_receipt\.ts"?\s+gate-check\b/.test(e.value));
  if (receipt < 0 || receipt > at) problems.push("no receipt call before the outcome call");
  const deterministic = ev.map((e, i) => ({ e, i })).filter(({ e }) => e.kind === "bash" && /\bbun test\b/.test(e.value));
  if (deterministic.length === 0) problems.push("no deterministic command");
  if (deterministic.some((d) => d.i > at)) problems.push("outcome call before a deterministic command");
  const stated = ev.filter((e) => e.kind === "text").map((e) => VERDICT.exec(e.value)).filter((m) => m !== null).pop();
  if (stated === undefined) return [...problems, "no stated verdict"];
  const arg = /\boutcome\s+gate-check\s+\S+\s+(pass|fail)\b/.exec(calls[0]!.e.value)?.[1];
  const want = stated[1] === "FAILED" ? "fail" : "pass";
  if (arg !== want) problems.push(`verdict ${arg} != stated ${stated[1]}`);
  return problems;
}

describe("AC-STE-715.16 live tool calls", () => {
  test("the slices directory is covered by the AC-STE-714.9 scan", () => {
    // Read from the suite's source: importing a test file would re-register its tests here.
    const src = readFileSync(join(PLUGIN_ROOT, "tests", "m_7bc805-ste-714-synthetic-ids.test.ts"), "utf-8");
    const decl = /export const SCRUBBED_FIXTURE_DIRS: readonly string\[\] = \[([^\]]*)\];/.exec(src);
    expect(decl).not.toBeNull();
    const dirs = [...decl![1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(dirs).toContain(SLICES_REL);
  });

  test("the off slice holds no outcome call", async () => {
    const isOutcome = await outcomeCall();
    const ev = events(slice("off"));
    expect(ev.some((e) => e.kind === "bash" && /gate_receipt\.ts"?\s+gate-check\b/.test(e.value))).toBe(true);
    expect(ev.filter((e) => e.kind === "bash" && isOutcome(e.value))).toEqual([]);
  });

  // Amended by AC-STE-715.16 (operator ruling 2026-11-06): the call carries the
  // verdict the report states and follows the receipt call and every deterministic
  // command; it is not graded against where the verdict text falls, since the
  // model records the outcome before writing its one closing report.
  test("the on slice holds exactly one outcome call, after the receipt and every deterministic command, carrying the stated verdict", async () => {
    const isOutcome = await outcomeCall();
    expect(gradeOnSlice(events(slice("on")), isOutcome)).toEqual([]);
  });

  // Amended by AC-STE-715.16 (operator ruling 2026-11-06): each clause of the grade can fail.
  test("CONTROL: a wrong verdict, an early call and a second call are each reported", async () => {
    const isOutcome = await outcomeCall();
    const receipt: Event = { kind: "bash", value: 'bun run "/x/gate_receipt.ts" gate-check "/r"' };
    const tests: Event = { kind: "bash", value: "bun test" };
    const call = (v: string): Event => ({ kind: "bash", value: `bun run "/x/gate_receipt.ts" outcome gate-check "/r" ${v} --step tests=pass` });
    const failed: Event = { kind: "text", value: "**GATE FAILED.**" };
    expect(gradeOnSlice([receipt, tests, call("fail"), failed], isOutcome)).toEqual([]);
    expect(gradeOnSlice([receipt, tests, call("pass"), failed], isOutcome)).toEqual(["verdict pass != stated FAILED"]);
    expect(gradeOnSlice([receipt, call("fail"), tests, failed], isOutcome)).toEqual(["outcome call before a deterministic command"]);
    expect(gradeOnSlice([receipt, tests, call("fail"), call("fail"), failed], isOutcome)).toEqual(["2 outcome calls"]);
  });
});

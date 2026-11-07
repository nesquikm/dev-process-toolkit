// STE-719 (M_d1b4b7) AC.6, AC.7, AC.8, AC.9 — the committed fixture triples.
//
// Each rule has a tripped / clear / skipped triple under
// tests/fixtures/m_d1b4b7-retro/<rule>/. The tripped fixture sits on the first
// value that trips and the clear fixture on the last value that does not
// (AC.7), so a comparator flipped strict <-> inclusive reds a named test. Two
// further cases model the tracking switches being off (AC.6). The fixtures are
// in the M_7bc805 formats and carry synthetic ids only (AC.8). The
// slow_gate_run pair doubles as the AC.9 pair: the Skill call's duration is the
// opposite of the gate run's wall time in both.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import {
  FIXTURE_ROOT,
  GC,
  KEY_A,
  RULE_IDS,
  SKIPPED,
  SR,
  SYNTHETIC_UUID,
  TDD,
  TIMELINE_RULE_IDS,
  UUID_RE,
  commitRows,
  gateRun,
  inputs,
  loadCase,
  resultFor,
  round,
  rulesMod,
  session,
  sid,
  timeline,
  tokenRow,
} from "./_m_d1b4b7_retro_fixture";

async function evalCase(rel: string): Promise<any[]> {
  const { evaluateRetroRules } = await rulesMod();
  return evaluateRetroRules(loadCase(rel));
}

async function evalInputs(i: ReturnType<typeof inputs>): Promise<any[]> {
  const { evaluateRetroRules } = await rulesMod();
  return evaluateRetroRules(i);
}

// ===========================================================================
// AC-STE-719.6 + AC-STE-719.7 — one triple per rule, on the boundary
// ===========================================================================

describe("AC-STE-719.6 / .7 slow_gate_run triple", () => {
  test("tripped: a gate-check run at wall_ms 900001 (first value over 900000)", async () => {
    const r = resultFor(await evalCase("slow_gate_run/tripped"), "slow_gate_run");
    expect(r.disposition).toBe("tripped");
  });
  test("clear: a gate-check run at wall_ms 900000 (last value not over the bound)", async () => {
    const r = resultFor(await evalCase("slow_gate_run/clear"), "slow_gate_run");
    expect(r.disposition).toBe("clear");
  });
  test("skipped: no gate run at all, with a non-empty reason; never clear", async () => {
    const r = resultFor(await evalCase("slow_gate_run/skipped"), "slow_gate_run");
    expect(r.disposition).toBe(SKIPPED);
    expect(typeof r.reason).toBe("string");
    expect(r.reason.length).toBeGreaterThan(0);
  });
  test("the spec-review and tdd bounds are per subject and strict", async () => {
    const one = async (subject: string, wall: number) =>
      resultFor(await evalInputs(inputs({ sessions: [session(1, timeline({ gate_runs: [gateRun(wall, { subject })] }))] })), "slow_gate_run")
        .disposition;
    expect(await one(SR, 1200001)).toBe("tripped");
    expect(await one(SR, 1200000)).toBe("clear");
    expect(await one(TDD, 3600001)).toBe("tripped");
    expect(await one(TDD, 3600000)).toBe("clear");
    // A gate-check bound would trip a spec-review run of 1000000; the per-subject bound does not.
    expect(await one(SR, 1000000)).toBe("clear");
  });
  test("a run whose outcome is `none` is not timed, even with a wall_ms over the bound", async () => {
    const r = resultFor(
      await evalInputs(inputs({ sessions: [session(1, timeline({ gate_runs: [gateRun(9_999_999, { outcome: "none" }), gateRun(10)] }))] })),
      "slow_gate_run",
    );
    expect(r.disposition).toBe("clear");
  });
});

describe("AC-STE-719.6 / .7 gate_rerun_unchanged_key triple", () => {
  test("tripped: two pass runs, same subject and key, key_stable true, across two sessions: sum 1", async () => {
    const r = resultFor(await evalCase("gate_rerun_unchanged_key/tripped"), "gate_rerun_unchanged_key");
    expect(r.disposition).toBe("tripped");
    expect(r.value).toBe(1);
  });
  test("clear: the repeated key is key_stable false on one pass run and a fail on another: sum 0", async () => {
    const r = resultFor(await evalCase("gate_rerun_unchanged_key/clear"), "gate_rerun_unchanged_key");
    expect(r.disposition).toBe("clear");
    expect(r.value).toBe(0);
  });
  test("skipped: no gate run at all, with a non-empty reason; never clear", async () => {
    const r = resultFor(await evalCase("gate_rerun_unchanged_key/skipped"), "gate_rerun_unchanged_key");
    expect(r.disposition).toBe(SKIPPED);
    expect(r.reason.length).toBeGreaterThan(0);
  });
  test("the sum is over (group size - 1): three stable pass runs of one key sum 2", async () => {
    const runs = [gateRun(1), gateRun(2), gateRun(3)];
    const r = resultFor(await evalInputs(inputs({ sessions: [session(1, timeline({ gate_runs: runs }))] })), "gate_rerun_unchanged_key");
    expect(r.value).toBe(2);
    expect(r.disposition).toBe("tripped");
  });
  test("the same key under two subjects is two groups", async () => {
    const runs = [gateRun(1, { subject: GC, key_digest: KEY_A }), gateRun(2, { subject: SR, key_digest: KEY_A })];
    const r = resultFor(await evalInputs(inputs({ sessions: [session(1, timeline({ gate_runs: runs }))] })), "gate_rerun_unchanged_key");
    expect(r.value).toBe(0);
    expect(r.disposition).toBe("clear");
  });
});

describe("AC-STE-719.6 / .7 zero_yield_round triple", () => {
  test("tripped: two zero-yield implement/refactor rounds (count 2, the first value that trips >= 2)", async () => {
    const r = resultFor(await evalCase("zero_yield_round/tripped"), "zero_yield_round");
    expect(r.disposition).toBe("tripped");
    expect(r.value).toBe(2);
  });
  test("clear: one zero-yield round (count 1); write-test rounds do not count", async () => {
    const r = resultFor(await evalCase("zero_yield_round/clear"), "zero_yield_round");
    expect(r.disposition).toBe("clear");
    expect(r.value).toBe(1);
  });
  test("skipped: no round at all, with a non-empty reason; never clear", async () => {
    const r = resultFor(await evalCase("zero_yield_round/skipped"), "zero_yield_round");
    expect(r.disposition).toBe(SKIPPED);
    expect(r.reason.length).toBeGreaterThan(0);
  });
  test("skipped when every implement/refactor round is `not-observable` (the M_7bc805 D5-no branch)", async () => {
    const rounds = [round("dev-process-toolkit:tdd-implement", null), round("dev-process-toolkit:tdd-refactor", null), round("dev-process-toolkit:tdd-implement", null)];
    const r = resultFor(await evalInputs(inputs({ sessions: [session(1, timeline({ rounds }))] })), "zero_yield_round");
    expect(r.disposition).toBe(SKIPPED);
    expect(r.reason.length).toBeGreaterThan(0);
  });
});

describe("AC-STE-719.6 / .7 cost_per_changed_line triple", () => {
  test("tripped: 5010 tokens over 10 main-scope lines is 501 (first value over 500); the fork commit row is ignored", async () => {
    const r = resultFor(await evalCase("cost_per_changed_line/tripped"), "cost_per_changed_line");
    expect(r.disposition).toBe("tripped");
    expect(r.value).toBe(501);
  });
  test("clear: 5000 tokens over 10 lines is 500 (last value not over the bound)", async () => {
    const r = resultFor(await evalCase("cost_per_changed_line/clear"), "cost_per_changed_line");
    expect(r.disposition).toBe("clear");
    expect(r.value).toBe(500);
  });
  test("skipped: no token-ledger row, with a non-empty reason; never clear", async () => {
    const r = resultFor(await evalCase("cost_per_changed_line/skipped"), "cost_per_changed_line");
    expect(r.disposition).toBe(SKIPPED);
    expect(r.reason.length).toBeGreaterThan(0);
  });
  test("skipped when tracking.token_stats is off, naming the key", async () => {
    const i = loadCase("cost_per_changed_line/tripped");
    i.tracking.token_stats = false;
    const r = resultFor(await evalInputs(i), "cost_per_changed_line");
    expect(r.disposition).toBe(SKIPPED);
    expect(r.reason).toContain("tracking.token_stats");
  });
  test("skipped when no commit row carries a diff, and when the line sum is 0", async () => {
    const tokens = [tokenRow(sid(1), 5000)];
    const noDiff = resultFor(await evalInputs(inputs({ sessions: [session(1, null, [])], token_rows: tokens })), "cost_per_changed_line");
    expect(noDiff.disposition).toBe(SKIPPED);
    expect(noDiff.reason.length).toBeGreaterThan(0);
    const zero = resultFor(
      await evalInputs(inputs({ sessions: [session(1, null, commitRows(0, 0))], token_rows: tokens })),
      "cost_per_changed_line",
    );
    expect(zero.disposition).toBe(SKIPPED);
    expect(zero.reason.length).toBeGreaterThan(0);
  });
  test("a fork-scope commit row alone carries no countable diff: skipped", async () => {
    const r = resultFor(
      await evalInputs(inputs({ sessions: [session(1, null, commitRows(10, 0, "fork"))], token_rows: [tokenRow(sid(1), 100)] })),
      "cost_per_changed_line",
    );
    expect(r.disposition).toBe(SKIPPED);
  });
  test("the numerator is labelled parent-visible tokens", async () => {
    const r = resultFor(await evalCase("cost_per_changed_line/tripped"), "cost_per_changed_line");
    expect(JSON.stringify(r)).toContain("parent-visible tokens");
  });
});

describe("AC-STE-719.6 no rule yields clear on any skipped fixture", () => {
  for (const id of RULE_IDS) {
    test(`${id}/skipped yields no clear for ${id}`, async () => {
      const r = resultFor(await evalCase(`${id}/skipped`), id);
      expect(r.disposition).not.toBe("clear");
      expect(r.disposition).toBe(SKIPPED);
    });
  }
});

describe("AC-STE-719.6 the tracking switches name themselves in a skip reason", () => {
  test("tracking.tool_calls off, no timeline file: each of the three timeline rules' reasons names tracking.tool_calls", async () => {
    const out = await evalCase("tool-calls-off");
    for (const id of TIMELINE_RULE_IDS) {
      const r = resultFor(out, id);
      expect({ id, d: r.disposition }).toEqual({ id, d: SKIPPED });
      expect({ id, names: String(r.reason).includes("tracking.tool_calls") }).toEqual({ id, names: true });
    }
  });
  test("no timeline file while tracking.tool_calls is ON: still skipped, with a reason that does not blame the switch", async () => {
    const i = loadCase("tool-calls-off");
    i.tracking.tool_calls = true;
    const out = await evalInputs(i);
    for (const id of TIMELINE_RULE_IDS) {
      const r = resultFor(out, id);
      expect(r.disposition).toBe(SKIPPED);
      expect(r.reason.length).toBeGreaterThan(0);
      expect(r.reason).not.toContain("tracking.tool_calls off");
    }
  });
  test("a timeline written while tracking.gate_outcomes was off: slow_gate_run and gate_rerun_unchanged_key name tracking.gate_outcomes", async () => {
    const out = await evalCase("gate-outcomes-off");
    for (const id of ["slow_gate_run", "gate_rerun_unchanged_key"]) {
      const r = resultFor(out, id);
      expect({ id, d: r.disposition }).toEqual({ id, d: SKIPPED });
      expect({ id, names: String(r.reason).includes("tracking.gate_outcomes") }).toEqual({ id, names: true });
    }
  });
});

// ===========================================================================
// AC-STE-719.9 — no v1 rule reads a Skill call's duration
// ===========================================================================

describe("AC-STE-719.9 gate wall time comes only from gate_runs[].wall_ms", () => {
  test("the tripped fixture's gate-check Skill call lasts 0 ms while its gate run's wall_ms is 900001", () => {
    const t = loadCase("slow_gate_run/tripped").sessions[0]!.timeline as any;
    const call = t.calls.find((c: any) => c.tool === "Skill" && c.skill === GC);
    expect([call.wall_ms, call.duration_ms]).toEqual([0, 0]);
    expect(t.gate_runs.map((g: any) => g.wall_ms)).toEqual([900001]);
  });
  test("the mirror fixture's Skill call lasts 900001 ms while its gate run's wall_ms is 900000", () => {
    const t = loadCase("slow_gate_run/clear").sessions[0]!.timeline as any;
    const call = t.calls.find((c: any) => c.tool === "Skill" && c.skill === GC);
    expect([call.wall_ms, call.duration_ms]).toEqual([900001, 900001]);
    expect(t.gate_runs.map((g: any) => g.wall_ms)).toEqual([900000]);
  });
  test("0 ms Skill call + wall_ms 900001 trips; 900001 ms Skill call + wall_ms 900000 is clear", async () => {
    expect(resultFor(await evalCase("slow_gate_run/tripped"), "slow_gate_run").disposition).toBe("tripped");
    expect(resultFor(await evalCase("slow_gate_run/clear"), "slow_gate_run").disposition).toBe("clear");
  });
  test("a 900001 ms gate-check Skill call with no gate run is skipped, never tripped", async () => {
    expect(resultFor(await evalCase("slow_gate_run/skipped"), "slow_gate_run").disposition).toBe(SKIPPED);
  });
});

// ===========================================================================
// AC-STE-719.8 — M_7bc805 formats and synthetic ids only
// ===========================================================================

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

describe("AC-STE-719.8 fixture formats and privacy", () => {
  const files = walk(FIXTURE_ROOT);

  test("anti-vacuity: the fixture tree holds every rule triple and both switch cases", () => {
    const cases = files.filter((f) => f.endsWith("case.json")).map((f) => relative(FIXTURE_ROOT, join(f, "..")));
    for (const id of RULE_IDS) for (const k of ["tripped", "clear", "skipped"]) expect(cases).toContain(join(id, k));
    expect(cases).toContain("tool-calls-off");
    expect(cases).toContain("gate-outcomes-off");
  });

  test("every timeline file is tool-call-timeline/v1 with calls, rounds, gate_runs and gaps", () => {
    const tl = files.filter((f) => f.endsWith(".timeline.json"));
    expect(tl.length).toBeGreaterThan(0);
    for (const f of tl) {
      const t = JSON.parse(readFileSync(f, "utf-8"));
      expect({ f: relative(FIXTURE_ROOT, f), schema: t.schema, keys: Object.keys(t).sort() }).toEqual({
        f: relative(FIXTURE_ROOT, f),
        schema: "tool-call-timeline/v1",
        keys: ["calls", "gaps", "gate_runs", "rounds", "schema"],
      });
      for (const g of t.gate_runs) expect(Object.keys(g).sort()).toEqual(["key_digest", "key_stable", "outcome", "ran_at", "subject", "wall_ms"]);
    }
  });

  test("every capture row is tool-call/v1 with the hook's field set", () => {
    const cap = files.filter((f) => f.endsWith(".jsonl") && f.includes(`${join("ledger", "tool-calls")}`));
    expect(cap.length).toBeGreaterThan(0);
    for (const f of cap) {
      for (const line of readFileSync(f, "utf-8").split("\n").filter((l) => l.trim() !== "")) {
        const row = JSON.parse(line);
        expect(row.schema).toBe("tool-call/v1");
        expect(Object.keys(row).sort()).toEqual(["class", "diff", "event", "schema", "scope", "skill", "tool", "tool_use_id", "tree", "ts"]);
      }
    }
  });

  test("every token-ledger row is token-ledger/v1", () => {
    const tok = files.filter((f) => f.endsWith("token-ledger.jsonl"));
    expect(tok.length).toBeGreaterThan(0);
    for (const f of tok) for (const line of readFileSync(f, "utf-8").split("\n").filter((l) => l.trim() !== "")) expect(JSON.parse(line).schema).toBe("token-ledger/v1");
  });

  test("no fixture holds /Users/, /home/ or a UUID outside the synthetic set", () => {
    const findings: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf-8");
      const rel = relative(FIXTURE_ROOT, f);
      if (text.includes("/Users/")) findings.push(`${rel}: /Users/`);
      if (text.includes("/home/")) findings.push(`${rel}: /home/`);
      for (const u of [...text.matchAll(UUID_RE)].map((m) => m[0])) if (!SYNTHETIC_UUID.test(u)) findings.push(`${rel}: ${u}`);
      for (const u of [...rel.matchAll(UUID_RE)].map((m) => m[0])) if (!SYNTHETIC_UUID.test(u)) findings.push(`${rel}: path ${u}`);
    }
    expect(findings).toEqual([]);
  });

  test("control: the scan's UUID rule catches a non-synthetic id", () => {
    const planted = "session 3f2b9c1e-7a4d-4e8f-9b2c-1d5e6f7a8b9c";
    const hits = [...planted.matchAll(UUID_RE)].map((m) => m[0]).filter((u) => !SYNTHETIC_UUID.test(u));
    expect(hits.length).toBe(1);
  });
});


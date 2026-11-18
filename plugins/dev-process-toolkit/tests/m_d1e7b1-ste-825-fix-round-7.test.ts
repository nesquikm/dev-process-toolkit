// STE-825 (M_d1e7b1) fix round 7 — AC-STE-825.4 (amended, fix round 7), new parts.
//
// V5-1 — a program word built by an expansion (a `$` or a backtick) that runs
// the front door's outcome verb cannot be read, so that call is unreadable and
// holds the commit after an earlier counted pass. A program word built by an
// expansion that runs some other file is no outcome call.
//
// G1 (pin) — the switch is read from the newest counted run of THIS checkout:
// another checkout's later run, with outcomes off there, does not switch this
// checkout's outcomes off.
//
// G2 (pin) — `bun run <flags> <door> outcome …` is a call whatever flags follow
// `run`.
//
// G3 (pin) — with outcomes off the outcome command says it recorded nothing, and
// that line is no outcome: a keyed run says `outcome: on`, the operator switches
// outcomes off, the SKILL's outcome call prints the off line, and a commit with
// no re-run is admitted.

import { afterAll, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  bashCall,
  cleanupTemps,
  FRONT_DOOR,
  makeTree,
  mintRun,
  outcomeCommand,
  receiptCommand,
  runCli,
  runHook,
  settingsFor,
  skillCall,
  stageCodeAndTest,
  tempDir,
  writeTranscript,
} from "./_m_7bc805_gate_outcome_fixture";
import { namesGateOutcomeFor } from "../adapters/_shared/src/gate_receipt";

const T = 120_000;
const GATE = "dev-process-toolkit:gate-check";

afterAll(() => cleanupTemps());

let seq = 0;
const rid = (p: string): string => `${p}-${++seq}`;

/** Record an outcome through the real CLI and return the announced Bash call. */
function outcome(root: string, verdict: "pass" | "fail"): string[] {
  const o = runCli(["outcome", "gate-check", root, verdict]);
  expect(o.exitCode).toBe(0);
  expect(o.stdout.startsWith("dpt-gate-outcome: ")).toBe(true);
  return bashCall(rid("o"), outcomeCommand("gate-check", root, verdict), o.stdout);
}

const runRecords = (root: string, run: ReturnType<typeof mintRun>): string[] =>
  bashCall(rid("r"), receiptCommand("gate-check", root), run.run.stdout);

const hook = (root: string, records: string[]) => runHook("gate", root, writeTranscript(tempDir("tr"), records));

/** Outcomes on, a run of checkout A and a counted pass for it, then `tail` — the hook's exit code. */
async function afterCountedPass(label: string, tail: (root: string) => string[]): Promise<number> {
  const root = makeTree(label, "on");
  stageCodeAndTest(root);
  const r1 = mintRun(root);
  const p = outcome(root, "pass");
  const r = await hook(root, [...skillCall("gate", "sk1"), ...runRecords(root, r1), ...p, ...tail(root)]);
  return r.exitCode;
}

// ---------------------------------------------------------------- V5-1

const EXPANDED_BUN: Array<[string, string]> = [
  ["(a) $(which bun)", "$(which bun)"],
  ["(b) `which bun`", "`which bun`"],
  ['(c) "$(command -v bun)"', '"$(command -v bun)"'],
  ["(d) ${BUN:-bun}", "${BUN:-bun}"],
  ["(e) $BUN", "$BUN"],
];

const expandedCall = (prog: string, door: string, root: string): string =>
  `${prog} ${door} outcome gate-check "${root}" fail`;

describe("AC-STE-825.4 V5-1 — a program word built by an expansion is an unreadable outcome call", () => {
  for (const [name, prog] of EXPANDED_BUN) {
    test(`unit: ${name} running the door's outcome verb names a gate-check outcome`, () => {
      expect(namesGateOutcomeFor(expandedCall(prog, FRONT_DOOR, "/tmp/v51-unit/repo"), GATE)).toBe(true);
    });

    test(`hook: counted pass, then ${name} <door> outcome … fail → refuses`, async () => {
      const code = await afterCountedPass(rid("v51"), (root) =>
        bashCall(rid("x"), expandedCall(prog, FRONT_DOOR, root), "done\n"),
      );
      expect(code).toBe(2);
    }, T);
  }

  test("unit control: $(which bun) running some other .ts names no outcome", () => {
    expect(namesGateOutcomeFor(expandedCall("$(which bun)", "/tmp/v51-unit/other.ts", "/tmp/v51-unit/repo"), GATE)).toBe(
      false,
    );
  });

  test("hook control: counted pass, then $(which bun) <other>.ts outcome … fail → admits", async () => {
    const code = await afterCountedPass(rid("v51-ctl"), (root) =>
      bashCall(rid("x"), expandedCall("$(which bun)", join(root, "..", "other.ts"), root), "done\n"),
    );
    expect(code).toBe(0);
  }, T);
});

// ---------------------------------------------------------------- G1

describe("AC-STE-825.4 G1 — another checkout's later run does not switch this checkout off", () => {
  test("A on: run + fail; B off runs later in the same transcript; commit to A → refuses", async () => {
    const a = makeTree(rid("g1-a"), "on");
    stageCodeAndTest(a);
    const ra = mintRun(a);
    expect(ra.run.stdout.split("\n")).toContain("outcome: on");
    const f = outcome(a, "fail");
    const b = makeTree(rid("g1-b"), "false");
    stageCodeAndTest(b);
    const rb = mintRun(b);
    expect(rb.run.stdout.split("\n")).not.toContain("outcome: on");
    const r = await hook(a, [...skillCall("gate", "sk1"), ...runRecords(a, ra), ...f, ...runRecords(b, rb)]);
    expect(r.exitCode).toBe(2);
  }, T);
});

// ---------------------------------------------------------------- G2

describe("AC-STE-825.4 G2 — flags after `run` keep the outcome call a call", () => {
  test("unit: bun run --silent <door> outcome gate-check names a gate-check outcome", () => {
    expect(namesGateOutcomeFor(`bun run --silent ${FRONT_DOOR} outcome gate-check "/tmp/g2-unit/repo" fail`, GATE)).toBe(
      true,
    );
  });

  test("hook: counted pass, then bun run --silent <door> outcome … fail (no announcement) → refuses", async () => {
    const code = await afterCountedPass(rid("g2"), (root) =>
      bashCall(rid("x"), `bun run --silent ${FRONT_DOOR} outcome gate-check "${root}" fail`, "done\n"),
    );
    expect(code).toBe(2);
  }, T);
});

// ---------------------------------------------------------------- G3

describe("AC-STE-825.4 G3 — the off line from the SKILL's outcome call is no outcome", () => {
  test("keyed run says outcome: on; switch turned off; the outcome call prints the off line; commit, no re-run → admits", async () => {
    const root = makeTree(rid("g3"), "on");
    stageCodeAndTest(root);
    const r1 = mintRun(root);
    expect(r1.run.stdout.split("\n")).toContain("outcome: on");
    writeFileSync(join(root, "specs", "settings.yaml"), settingsFor("false")!);
    const o = runCli(["outcome", "gate-check", root, "pass"]);
    expect(o.exitCode).toBe(0);
    expect(o.stdout).toBe("no gate outcome was recorded: outcomes are off for this checkout\n");
    const r = await hook(root, [
      ...skillCall("gate", "sk1"),
      ...runRecords(root, r1),
      ...bashCall(rid("o"), outcomeCommand("gate-check", root, "pass"), o.stdout),
    ]);
    expect(r.exitCode).toBe(0);
  }, T);
});

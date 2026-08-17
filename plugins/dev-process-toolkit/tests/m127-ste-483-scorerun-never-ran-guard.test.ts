// M127 STE-483 — `scoreRun`'s never-ran refusal, pinned.
//
// WHY THIS FILE EXISTS, SEPARATELY FROM THE HARNESS TEST.
//
// `scoreRun(run, "exit-code")` refuses to score — it THROWS — when the run's
// exit status says the command never really executed. That guard was added to
// `adapters/_shared/src/falsifiability_harness.ts` during M127's refactor pass
// and NO ac pins it. In the milestone whose entire subject is assertions that
// cannot fail, the anti-vacuity guard was itself unfalsifiable: deleting the
// throw left the whole suite green.
//
// WHAT THE GUARD IS FOR. `capability_row_assert` exits 2 on a USAGE ERROR but 1
// on a genuine miss; bash exits 127 on command-not-found and 126 on
// not-executable. Under a naive `exitCode === 0 ? 1 : 0` all of those collapse
// into the same 0 as a legitimate RED — so a typo'd verb, a moved module or a
// mis-bound path makes the ABSENT half score 0, the pair reads 1-vs-0, and the
// assertion is certified falsifiable on the strength of a command that never
// executed. That is the "mutation that never applied" class (the M124 lesson)
// arriving in the SCORER instead of the mutator, and M127 met it twice by hand
// before the guard existed.
//
// THE HOLE AT -1. `runAssertion` reports `proc.status ?? -1`, and `spawnSync`
// yields a null status on a SPAWN FAILURE or a SIGNAL KILL — both of them
// unambiguously "never ran". `-1` is not in the guarded set, so both currently
// score a silent 0 and certify the pair falsifiable on a command that never
// executed: the exact class the guard was added to close, still open one status
// code over. The signal-kill case below reaches that state for real (`kill -9
// $$` through the module's own `runAssertion`), so the pin is behavioural
// rather than a synthetic literal.
//
// NON-VACUITY, AND WHY IT IS NOT SELF-SATISFYING. Three independent failure
// modes are separated rather than folded into one another:
//
//   1. Per-status refusal. Every documented member throws, and the message
//      names the offending status. Deleting ONE member from the set reddens
//      exactly that member's case and no other.
//   2. Set parity. The module's own `NEVER_RAN_EXIT_CODES` literal is read out
//      of the source and compared to the list this file documents, so the
//      documented list cannot silently drift away from the implementation. This
//      can fail while (1) passes (a member listed but not honoured) and (1) can
//      fail while this passes (the throw deleted, the set left standing).
//   3. Boundary statuses. Statuses immediately OUTSIDE the set — 1, 3, 125, 128
//      — must NOT throw. A guard written as "anything but 0 or 1 never ran"
//      satisfies every case in (1) and (2) and fails only here, which is why
//      these are not a restatement of the members passing.
//
// AND THE MODE BOUNDARY. `stdout-count` returns `run.count` whatever the exit
// status is, so the guard cannot reach STE-484's row — the one registry entry
// that keeps the default mode.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  M127_REPAIRS,
  runAssertion,
  scoreRun,
  type AssertionRun,
  type RepairEntry,
} from "../adapters/_shared/src/falsifiability_harness";

const PLUGIN_ROOT = join(import.meta.dir, "..");
const HARNESS_MODULE = join(
  PLUGIN_ROOT,
  "adapters",
  "_shared",
  "src",
  "falsifiability_harness.ts",
);

/**
 * The statuses that mean "this command never really ran", spelled here
 * INDEPENDENTLY of the module so the two can disagree and be caught:
 *
 *   2   — `capability_row_assert`'s usage error (1 is its genuine miss)
 *   126 — bash: found but not executable
 *   127 — bash: command not found
 *   -1  — `runAssertion`'s `proc.status ?? -1`: spawn failure or signal kill
 */
const DOCUMENTED_NEVER_RAN: readonly number[] = [-1, 2, 126, 127];

/** Statuses just outside the set, which must still be scored, never refused. */
const SCORABLE_STATUSES: readonly number[] = [0, 1, 3, 125, 128];

const ascending = (codes: readonly number[]): number[] =>
  [...codes].sort((a, b) => a - b);

/** The `NEVER_RAN_EXIT_CODES` members the module itself declares. */
function sourceNeverRanCodes(): number[] {
  const source = readFileSync(HARNESS_MODULE, "utf8");
  const literal = /NEVER_RAN_EXIT_CODES\s*=\s*new Set\(\s*\[([^\]]*)\]/.exec(source);
  if (!literal) {
    throw new Error(
      "falsifiability_harness.ts: no `NEVER_RAN_EXIT_CODES = new Set([...])` literal — " +
        "the never-ran guard is gone or was rewritten into a shape this pin cannot read",
    );
  }
  return ascending(
    (literal[1] as string)
      .split(",")
      .map((piece) => piece.trim())
      .filter((piece) => piece !== "")
      .map((piece) => Number(piece)),
  );
}

/** An `AssertionRun` carrying one exit status. Nothing else varies. */
function runWithStatus(exitCode: number, count = 0): AssertionRun {
  return {
    command: "bun ${CAP_ASSERT} --log /tmp/dpt-smoke-linear-implement.log --key present",
    exitCode,
    stdout: "",
    count,
  };
}

describe("scoreRun refuses to score a command that never ran (exit-code mode)", () => {
  for (const code of DOCUMENTED_NEVER_RAN) {
    test(`status ${code} throws, and the message names the status`, () => {
      expect(() => scoreRun(runWithStatus(code), "exit-code")).toThrow(
        new RegExp(`exited ${code},`),
      );
    });
  }

  test("the module's own set is what the documented list describes", () => {
    // Fails independently of the per-status cases: a member could be listed and
    // not honoured, or honoured and not listed.
    expect(sourceNeverRanCodes()).toEqual(ascending(DOCUMENTED_NEVER_RAN));
  });

  test("0 and 1 — met and not-met — are scored, not refused", () => {
    expect(scoreRun(runWithStatus(0), "exit-code")).toBe(1);
    expect(scoreRun(runWithStatus(1), "exit-code")).toBe(0);
  });

  test("statuses outside the set are scored 0, never refused", () => {
    // A guard written as "anything but 0 or 1 never ran" passes every case
    // above and fails only here.
    for (const code of SCORABLE_STATUSES.filter((c) => c !== 0)) {
      expect(scoreRun(runWithStatus(code), "exit-code")).toBe(0);
    }
  });

  test("a signal-killed command reaches scoreRun as -1 and is refused", () => {
    // Not a synthetic literal: `spawnSync` returns a null status on a signal
    // kill, `runAssertion` maps that to -1, and that -1 is indistinguishable
    // from a legitimate RED unless the guard covers it.
    const killed = runAssertion({ command: "kill -9 $$", capturePath: "/dev/null" });
    expect(killed.exitCode).toBe(-1);
    expect(() => scoreRun(killed, "exit-code")).toThrow(/exited -1,/);
  });
});

describe("stdout-count mode is untouched by the guard", () => {
  test("every status — refused or not — still returns run.count", () => {
    for (const code of [...DOCUMENTED_NEVER_RAN, ...SCORABLE_STATUSES]) {
      expect(scoreRun(runWithStatus(code, 7), "stdout-count")).toBe(7);
    }
  });

  test("STE-484's row keeps the default mode, so the guard cannot reach it", () => {
    const ste484 = M127_REPAIRS.find((row) => row.id === "STE-484") as RepairEntry;
    const mode = ste484.scoreBy ?? "stdout-count";
    expect(mode).toBe("stdout-count");
    expect(scoreRun(runWithStatus(127, 3), mode)).toBe(3);
  });
});

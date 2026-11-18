// STE-825 (M_d1e7b1) fix round 6 — AC-STE-825.4 (amended, fix round 6), new parts.
//
// RE1 — the switch is read from the newest counted run of this checkout: when
// its receipt has no key field, gate outcomes are off. A run whose key could not
// be computed still has the field, so the switch reads on, the run still says
// `outcome: on`, and its outcome is recorded.
//
// RE2 — with outcomes off the outcome command says it recorded nothing, and that
// line is no outcome; an outcome call for a path in no checkout fails, so it is
// unreadable.
//
// RE3 — a backslash-newline continuation outside single quotes keeps an outcome
// call one plain call.

import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  bashCall,
  cleanupTemps,
  FRONT_DOOR,
  makeTree,
  mintRun,
  outcomeCommand,
  readJson,
  receiptCommand,
  runCli,
  runHook,
  SETTINGS_HEAD,
  settingsFor,
  skillCall,
  stageCodeAndTest,
  tempDir,
  writeTranscript,
} from "./_m_7bc805_gate_outcome_fixture";
import { runsGateOutcome } from "../adapters/_shared/src/gate_receipt";

const T = 120_000;
const OFF_LINE = "no gate outcome was recorded";
const OFF_THIS_CHECKOUT = "no gate outcome was recorded: outcomes are off for this checkout";
const IS_ROOT = typeof process.getuid === "function" && process.getuid() === 0;

afterAll(() => cleanupTemps());

let seq = 0;
const rid = (p: string): string => `${p}-${++seq}`;

/** Record an outcome through the real CLI and return the announced Bash call. */
function outcome(root: string, verdict: "pass" | "fail", steps: string[] = [], command?: string): string[] {
  const o = runCli(["outcome", "gate-check", root, verdict, ...steps.flatMap((s) => ["--step", s])]);
  expect(o.exitCode).toBe(0);
  expect(o.stdout.startsWith("dpt-gate-outcome: ")).toBe(true);
  return bashCall(rid("o"), command ?? outcomeCommand("gate-check", root, verdict, steps), o.stdout);
}

const runRecords = (root: string, run: ReturnType<typeof mintRun>): string[] =>
  bashCall(rid("r"), receiptCommand("gate-check", root), run.run.stdout);

const hook = (root: string, records: string[]) => runHook("gate", root, writeTranscript(tempDir("tr"), records));

function flip(root: string, state: "on" | "false" | "absent"): void {
  writeFileSync(join(root, "specs", "settings.yaml"), settingsFor(state) ?? SETTINGS_HEAD);
}

const evidenceOf = (run: ReturnType<typeof mintRun>): Record<string, unknown> =>
  (readJson(run.path).evidence ?? {}) as Record<string, unknown>;

// ---------------------------------------------------------------- RE1

const BREAKERS: Array<[string, (root: string) => void, boolean]> = [
  [
    "K-EISDIR (untracked symlink to a directory outside the tree)",
    (root) => {
      mkdirSync(join(root, "..", "shared"), { recursive: true });
      symlinkSync("../shared", join(root, "shared"));
    },
    false,
  ],
  [
    "K-EACCES (untracked file chmod 000)",
    (root) => {
      writeFileSync(join(root, "out.bin"), "x");
      chmodSync(join(root, "out.bin"), 0o000);
    },
    IS_ROOT, // root reads a 000 file, so the key would not fail
  ],
];

/** Switch on, r1 keyed with a fail recorded, then the key made uncomputable and r2 minted. */
function keyFailedScenario(label: string, brk: (root: string) => void) {
  const root = makeTree(label, "on");
  stageCodeAndTest(root);
  const r1 = mintRun(root);
  const f = outcome(root, "fail");
  brk(root);
  const r2 = mintRun(root);
  return { root, r1, f, r2 };
}

describe("AC-STE-825.4 RE1 — a run whose key could not be computed still reads on", () => {
  // Not a skip call site (AC-STE-616.16 pins those by name): a breaker that
  // cannot break the key for this user (root reads a 000 file) defines no test.
  for (const [name, brk, skip] of BREAKERS) {
    if (skip) continue;
    test(`${name}: r2's receipt carries the key field, its digest null`, () => {
      const { r2 } = keyFailedScenario(rid("re1-ev"), brk);
      const ev = evidenceOf(r2);
      expect("key_digest" in ev).toBe(true);
      expect(ev.key_digest).toBeNull();
    }, T);

    test(`${name}: r2's mint still says outcome: on`, () => {
      const { r2 } = keyFailedScenario(rid("re1-on"), brk);
      expect(r2.run.stdout.split("\n")).toContain("outcome: on");
    }, T);

    test(`${name}: keyed fail, key-failed r2, no later outcome → refuses`, async () => {
      const { root, r1, f, r2 } = keyFailedScenario(rid("re1-hk"), brk);
      const r = await hook(root, [
        ...skillCall("gate", "sk1"),
        ...runRecords(root, r1),
        ...f,
        ...skillCall("gate", "sk2"),
        ...runRecords(root, r2),
      ]);
      expect(r.exitCode).toBe(2);
    }, T);
  }

  test("K-record: key-failed r2, a pass recorded through the real CLI → admits", async () => {
    const { root, r1, f, r2 } = keyFailedScenario(rid("re1-rec"), BREAKERS[0]![1]);
    const p = runCli(["outcome", "gate-check", root, "pass"]);
    expect(p.exitCode).toBe(0);
    expect(p.stdout.split("\n").some((l) => l.startsWith("dpt-gate-outcome: "))).toBe(true);
    const r = await hook(root, [
      ...skillCall("gate", "sk1"),
      ...runRecords(root, r1),
      ...f,
      ...skillCall("gate", "sk2"),
      ...runRecords(root, r2),
      ...bashCall(rid("o"), outcomeCommand("gate-check", root, "pass"), p.stdout),
    ]);
    expect(r.exitCode).toBe(0);
  }, T);

  for (const state of ["false", "absent"] as const) {
    test(`control (${state}): switch really off → mint has no outcome: on`, () => {
      const root = makeTree(rid(`re1-off-${state}`), state);
      stageCodeAndTest(root);
      const r1 = mintRun(root);
      expect(r1.run.stdout.split("\n")).not.toContain("outcome: on");
    }, T);

    test(`control (${state}): switch really off → receipt evidence has no key_digest key`, () => {
      const root = makeTree(rid(`re1-offev-${state}`), state);
      stageCodeAndTest(root);
      const r1 = mintRun(root);
      expect("key_digest" in evidenceOf(r1)).toBe(false);
    }, T);

    test(`control (${state}): keyed fail, flip off, unkeyed r2 → admits`, async () => {
      const root = makeTree(rid(`re1-offhk-${state}`), "on");
      stageCodeAndTest(root);
      const r1 = mintRun(root);
      const f = outcome(root, "fail");
      flip(root, state);
      const r2 = mintRun(root);
      const r = await hook(root, [
        ...skillCall("gate", "sk1"),
        ...runRecords(root, r1),
        ...f,
        ...skillCall("gate", "sk2"),
        ...runRecords(root, r2),
      ]);
      expect(r.exitCode).toBe(0);
    }, T);
  }

  test("control: switch on with a good key, keyed r1 pass → admits", async () => {
    const root = makeTree(rid("re1-good"), "on");
    stageCodeAndTest(root);
    const r1 = mintRun(root);
    expect(r1.run.stdout.split("\n")).toContain("outcome: on");
    const p = outcome(root, "pass");
    const r = await hook(root, [...skillCall("gate", "sk1"), ...runRecords(root, r1), ...p]);
    expect(r.exitCode).toBe(0);
  }, T);
});

// ---------------------------------------------------------------- RE2

describe("AC-STE-825.4 RE2 — the off line, and a path in no checkout", () => {
  const nowhereCases: Array<[string, () => string]> = [
    ["a temp dir that is no git repo", () => tempDir("re2-nowhere")],
    ["a mistyped sibling of a real root", () => makeTree(rid("re2-typo"), "on").replace(/repo$/, "rpeo")],
  ];
  for (const [name, path] of nowhereCases) {
    test(`CLI: outcome for ${name} exits non-zero`, () => {
      const o = runCli(["outcome", "gate-check", path(), "fail"]);
      expect(o.exitCode).not.toBe(0);
    });
    test(`CLI: outcome for ${name} prints nothing on stdout`, () => {
      const o = runCli(["outcome", "gate-check", path(), "fail"]);
      expect(o.stdout).toBe("");
    });
    test(`CLI: outcome for ${name} never prints the off line`, () => {
      const o = runCli(["outcome", "gate-check", path(), "fail"]);
      expect(o.stdout.startsWith(OFF_LINE)).toBe(false);
    });
  }

  test("CLI: switch off in a real checkout prints exactly one off line for this checkout", () => {
    const root = makeTree(rid("re2-off"), "false");
    const o = runCli(["outcome", "gate-check", root, "pass"]);
    const lines = o.stdout.split("\n").filter((l) => l !== "");
    expect(lines.length).toBe(1);
    expect(lines[0]!.startsWith(OFF_THIS_CHECKOUT)).toBe(true);
  });

  test("CLI: the off line for a real checkout does not mention 'no checkout'", () => {
    const root = makeTree(rid("re2-off-nc"), "false");
    const o = runCli(["outcome", "gate-check", root, "pass"]);
    expect(o.stdout).not.toContain("no checkout");
  });

  test("P1: pass on r1, r2, an honest fail call with a mistyped root → refuses", async () => {
    const root = makeTree(rid("re2-p1"), "on");
    stageCodeAndTest(root);
    const r1 = mintRun(root);
    const p = outcome(root, "pass");
    const r2 = mintRun(root);
    const typo = root.replace(/repo$/, "rpeo");
    const f = runCli(["outcome", "gate-check", typo, "fail"]);
    const r = await hook(root, [
      ...skillCall("gate", "sk1"),
      ...runRecords(root, r1),
      ...p,
      ...runRecords(root, r2),
      ...bashCall(rid("o"), outcomeCommand("gate-check", typo, "fail"), f.stdout),
    ]);
    expect(r.exitCode).toBe(2);
  }, T);

  test("real off: unkeyed r1, a stray outcome call with its real output → admits", async () => {
    const root = makeTree(rid("re2-realoff"), "false");
    stageCodeAndTest(root);
    const r1 = mintRun(root);
    const stray = runCli(["outcome", "gate-check", root, "fail"]);
    const r = await hook(root, [
      ...skillCall("gate", "sk1"),
      ...runRecords(root, r1),
      ...bashCall(rid("o"), outcomeCommand("gate-check", root, "fail"), stray.stdout),
    ]);
    expect(r.exitCode).toBe(0);
  }, T);
});

// ---------------------------------------------------------------- RE3

describe("AC-STE-825.4 RE3 — a backslash-newline continuation keeps one plain call", () => {
  const root = "/tmp/re3-unit/repo";
  test("continuation before --step flags is one plain outcome call", () => {
    expect(runsGateOutcome(`bun run ${FRONT_DOOR} outcome gate-check ${root} pass \\\n  --step lint=pass --step test=pass`)).toBe(true);
  });
  test("a backslash-newline inside single quotes in an argument is no plain call", () => {
    expect(runsGateOutcome(`bun run ${FRONT_DOOR} outcome gate-check '${root}\\\n' pass`)).toBe(false);
  });
  test("a continuation followed by 2>&1 is still no plain call", () => {
    expect(runsGateOutcome(`bun run ${FRONT_DOOR} outcome gate-check ${root} pass \\\n  2>&1`)).toBe(false);
  });
  test("2>&1 on one line is still no plain call", () => {
    expect(runsGateOutcome(`bun run ${FRONT_DOOR} outcome gate-check ${root} pass 2>&1`)).toBe(false);
  });

  test("hook: fail recorded, r2, an honest pass written with a continuation → admits", async () => {
    const tree = makeTree(rid("re3-hk"), "on");
    stageCodeAndTest(tree);
    const r1 = mintRun(tree);
    const f = outcome(tree, "fail");
    const r2 = mintRun(tree);
    const steps = ["lint=pass", "test=pass"];
    const p = outcome(
      tree,
      "pass",
      steps,
      `${outcomeCommand("gate-check", tree, "pass")} \\\n  --step lint=pass --step test=pass`,
    );
    const r = await hook(tree, [
      ...skillCall("gate", "sk1"),
      ...runRecords(tree, r1),
      ...f,
      ...runRecords(tree, r2),
      ...p,
    ]);
    expect(r.exitCode).toBe(0);
  }, T);
});

// STE-825 (M_d1e7b1) fix round 5 — AC-STE-825.4 (amended, fix round 5), new parts.
//
// RD1 — the switch: it is read from the newest counted run of this checkout.
// When that run carries no key, gate outcomes are off and no outcome, pending or
// unreadable call is graded. With outcomes off the outcome command says it
// recorded nothing, and that line is no outcome. Switched back on, every counted
// outcome is graded again, so a fail recorded before the off run still refuses
// until a later counted pass.
//
// RD2 — command position: a segment runs the outcome verb when a `bun` in
// command position runs the front door, whatever path or flags spell `bun`; a
// word inside quotes or a heredoc body is never a call.

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
  SETTINGS_HEAD,
  settingsFor,
  skillCall,
  stageCodeAndTest,
  tempDir,
  writeTranscript,
} from "./_m_7bc805_gate_outcome_fixture";
import { namesGateOutcomeFor } from "../adapters/_shared/src/gate_receipt";

const T = 120_000;
const GATE = "dev-process-toolkit:gate-check";
const OFF_LINE = "no gate outcome was recorded";

afterAll(() => cleanupTemps());

let seq = 0;
const rid = (p: string): string => `${p}-${++seq}`;
const door = '"${CLAUDE_PLUGIN_ROOT}/adapters/_shared/src/gate_receipt.ts"';

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

function flip(root: string, state: "on" | "false" | "absent"): void {
  writeFileSync(join(root, "specs", "settings.yaml"), settingsFor(state) ?? SETTINGS_HEAD);
}

// ---------------------------------------------------------------- RD1

describe("AC-STE-825.4 RD1 — the switch is read from the newest counted run", () => {
  for (const after of ["false", "absent"] as const) {
    test(`S1-${after}: fail recorded while on, switch turned ${after}, re-run unkeyed → admits`, async () => {
      const root = makeTree(`rd1-s1-${after}`, "on");
      stageCodeAndTest(root);
      const r1 = mintRun(root);
      const f = outcome(root, "fail");
      flip(root, after);
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

  test("S2: the outcome command with outcomes off says it recorded nothing", () => {
    const root = makeTree("rd1-s2-cli", "false");
    const o = runCli(["outcome", "gate-check", root, "pass"]);
    expect(o.stdout.startsWith(OFF_LINE)).toBe(true);
  });

  test("S2: pass while on, switch off, re-run, a stray outcome call printing the off line → admits", async () => {
    const root = makeTree("rd1-s2", "on");
    stageCodeAndTest(root);
    const r1 = mintRun(root);
    const p = outcome(root, "pass");
    flip(root, "false");
    const r2 = mintRun(root);
    const off = runCli(["outcome", "gate-check", root, "pass"]);
    expect(off.stdout.startsWith(OFF_LINE)).toBe(true);
    const r = await hook(root, [
      ...skillCall("gate", "sk1"),
      ...runRecords(root, r1),
      ...p,
      ...skillCall("gate", "sk2"),
      ...runRecords(root, r2),
      ...bashCall(rid("o"), outcomeCommand("gate-check", root, "pass"), off.stdout),
    ]);
    expect(r.exitCode).toBe(0);
  }, T);

  // Amended by AC-STE-825.4 (M_d1e7b1) fix round 6
  test("S2b: outcomes on, an outcome call for a path in no checkout is unreadable → refuses", async () => {
    const root = makeTree("rd1-s2b", "on");
    stageCodeAndTest(root);
    const r1 = mintRun(root);
    const p = outcome(root, "pass");
    const nowhere = tempDir("rd1-s2b-nowhere");
    const off = runCli(["outcome", "gate-check", nowhere, "pass"]);
    const r = await hook(root, [
      ...skillCall("gate", "sk1"),
      ...runRecords(root, r1),
      ...p,
      ...bashCall(rid("o"), outcomeCommand("gate-check", nowhere, "pass"), off.stdout),
    ]);
    expect(r.exitCode).toBe(2);
  }, T);

  test("C-on control: fail recorded, re-run still keyed, no later outcome → refuses", async () => {
    const root = makeTree("rd1-con", "on");
    stageCodeAndTest(root);
    const r1 = mintRun(root);
    const f = outcome(root, "fail");
    const r2 = mintRun(root);
    const r = await hook(root, [
      ...skillCall("gate", "sk1"),
      ...runRecords(root, r1),
      ...f,
      ...skillCall("gate", "sk2"),
      ...runRecords(root, r2),
    ]);
    expect(r.exitCode).toBe(2);
  }, T);

  test("switch back on: off run, then keyed run whose fail is recorded → refuses", async () => {
    const root = makeTree("rd1-back-fail", "false");
    stageCodeAndTest(root);
    const r1 = mintRun(root);
    flip(root, "on");
    const r2 = mintRun(root);
    const f = outcome(root, "fail");
    const r = await hook(root, [
      ...skillCall("gate", "sk1"),
      ...runRecords(root, r1),
      ...skillCall("gate", "sk2"),
      ...runRecords(root, r2),
      ...f,
    ]);
    expect(r.exitCode).toBe(2);
  }, T);

  test("switch back on: off run, then keyed run whose pass is recorded → admits", async () => {
    const root = makeTree("rd1-back-pass", "false");
    stageCodeAndTest(root);
    const r1 = mintRun(root);
    flip(root, "on");
    const r2 = mintRun(root);
    const p = outcome(root, "pass");
    const r = await hook(root, [
      ...skillCall("gate", "sk1"),
      ...runRecords(root, r1),
      ...skillCall("gate", "sk2"),
      ...runRecords(root, r2),
      ...p,
    ]);
    expect(r.exitCode).toBe(0);
  }, T);

  test("switch back on: a fail recorded before the off run still refuses until a new pass", async () => {
    const root = makeTree("rd1-back-oldfail", "on");
    stageCodeAndTest(root);
    const r1 = mintRun(root);
    const f = outcome(root, "fail");
    flip(root, "false");
    const r2 = mintRun(root);
    flip(root, "on");
    const r3 = mintRun(root);
    const r = await hook(root, [
      ...skillCall("gate", "sk1"),
      ...runRecords(root, r1),
      ...f,
      ...skillCall("gate", "sk2"),
      ...runRecords(root, r2),
      ...skillCall("gate", "sk3"),
      ...runRecords(root, r3),
    ]);
    expect(r.exitCode).toBe(2);
  }, T);

  test("switch back on: an older pending call is cleared by the later counted pass → admits (control)", async () => {
    const root = makeTree("rd1-back-pending", "false");
    stageCodeAndTest(root);
    const r1 = mintRun(root);
    const [strayCall] = bashCall(rid("o"), outcomeCommand("gate-check", root, "fail"), "");
    flip(root, "on");
    const r2 = mintRun(root);
    const p = outcome(root, "pass");
    const r = await hook(root, [
      ...skillCall("gate", "sk1"),
      ...runRecords(root, r1),
      strayCall!,
      ...skillCall("gate", "sk2"),
      ...runRecords(root, r2),
      ...p,
    ]);
    expect(r.exitCode).toBe(0);
  }, T);
});

// ---------------------------------------------------------------- RD2

const MENTIONS: Array<[string, (root: string) => string]> = [
  ["M1 echo of the call in double quotes", (root) => `echo "next: bun run ${FRONT_DOOR} outcome gate-check ${root} pass"`],
  ["M2 grep for the call in docs", () => `grep -rn "bun run adapters/_shared/src/gate_receipt.ts outcome gate-check" docs`],
  [
    "M3 quoted-delimiter heredoc body",
    () => `cat > notes.md <<'EOF'\nThen run: bun run adapters/_shared/src/gate_receipt.ts outcome gate-check . pass\nEOF`,
  ],
  [
    "M3b unquoted-delimiter heredoc body",
    () => `cat > notes.md <<EOF\nThen run: bun run adapters/_shared/src/gate_receipt.ts outcome gate-check . pass\nEOF`,
  ],
  [
    "M4 commit message heredoc naming the call",
    () => `git commit -q -F - <<'EOF'\ndocs: say bun run gate_receipt.ts outcome gate-check <root> pass\nEOF`,
  ],
  ["M6 single-quoted commit message", () => `git commit -m 'docs: bun run gate_receipt.ts outcome gate-check . fail'`],
];

const REAL_CALLS: Array<[string, (root: string) => string]> = [
  ["env-prefixed bun", (root) => `FOO=1 bun run ${FRONT_DOOR} outcome gate-check ${root} fail`],
  ["absolute bun with flags after cd &&", (root) => `cd ${root} && /usr/local/bin/bun --smol run ${FRONT_DOOR} outcome gate-check ${root} fail`],
  ["bun after `true;`", (root) => `true; bun ${FRONT_DOOR} outcome gate-check ${root} fail`],
  ["second line of a two-line command", (root) => `echo start\nbun run ${FRONT_DOOR} outcome gate-check ${root} fail`],
];

describe("AC-STE-825.4 RD2 — a word in quotes or a heredoc body is never a call (hook)", () => {
  for (const [name, cmd] of MENTIONS) {
    test(`${name}, after a counted pass → admits`, async () => {
      const root = makeTree(rid("rd2-m"), "on");
      stageCodeAndTest(root);
      const r1 = mintRun(root);
      const p = outcome(root, "pass");
      const r = await hook(root, [...skillCall("gate", "sk1"), ...runRecords(root, r1), ...p, ...bashCall(rid("x"), cmd(root), "ok")]);
      expect(r.exitCode).toBe(0);
    }, T);
  }

  for (const [name, cmd] of REAL_CALLS) {
    test(`control: unreadable real outcome call (${name}) after a counted pass → refuses`, async () => {
      const root = makeTree(rid("rd2-c"), "on");
      stageCodeAndTest(root);
      const r1 = mintRun(root);
      const p = outcome(root, "pass");
      const r = await hook(root, [...skillCall("gate", "sk1"), ...runRecords(root, r1), ...p, ...bashCall(rid("x"), cmd(root), "ok")]);
      expect(r.exitCode).toBe(2);
    }, T);
  }
});

describe("AC-STE-825.4 RD2 — namesGateOutcomeFor reads command position", () => {
  const root = "/tmp/rd2-unit/repo";
  for (const [name, cmd] of MENTIONS) {
    test(`${name} names no gate outcome`, () => {
      expect(namesGateOutcomeFor(cmd(root), GATE)).toBe(false);
    });
  }
  test("M1 with the ${CLAUDE_PLUGIN_ROOT} door inside the quotes names no gate outcome", () => {
    expect(namesGateOutcomeFor(`echo "bun run ${door} outcome gate-check ${root} pass"`, GATE)).toBe(false);
  });
  for (const [name, cmd] of REAL_CALLS) {
    test(`real call (${name}) names the gate outcome`, () => {
      expect(namesGateOutcomeFor(cmd(root), GATE)).toBe(true);
    });
  }
});

// ---------------------------------------------------------------- cf-verify addendum (recheck 3)

describe("AC-STE-825.4 RD1 — mixed keyed and unkeyed runs, both flip directions", () => {
  test("on → off: a keyed counted pass, then an unkeyed run, then an uncounted outcome call → admits", async () => {
    const root = makeTree("mix-on-off", "on");
    stageCodeAndTest(root);
    const r1 = mintRun(root);
    const p = outcome(root, "pass");
    flip(root, "false");
    const r2 = mintRun(root);
    const r = await hook(root, [
      ...skillCall("gate", "sk1"),
      ...runRecords(root, r1),
      ...p,
      ...skillCall("gate", "sk2"),
      ...runRecords(root, r2),
      ...bashCall(rid("u"), outcomeCommand("gate-check", root, "fail"), "ok"),
    ]);
    expect(r.exitCode).toBe(0);
  }, T);

  test("off → on: an unkeyed run, then a keyed run, then an uncounted outcome call → refuses", async () => {
    const root = makeTree("mix-off-on", "false");
    stageCodeAndTest(root);
    const r1 = mintRun(root);
    flip(root, "on");
    const r2 = mintRun(root);
    const r = await hook(root, [
      ...skillCall("gate", "sk1"),
      ...runRecords(root, r1),
      ...skillCall("gate", "sk2"),
      ...runRecords(root, r2),
      ...bashCall(rid("u"), outcomeCommand("gate-check", root, "fail"), "ok"),
    ]);
    expect(r.exitCode).toBe(2);
  }, T);

  test("derived: keyed fail, switch off, unkeyed re-run whose pass call prints the off line → admits", async () => {
    const root = makeTree("mix-derived", "on");
    stageCodeAndTest(root);
    const r1 = mintRun(root);
    const f = outcome(root, "fail");
    flip(root, "false");
    const r2 = mintRun(root);
    const off = runCli(["outcome", "gate-check", root, "pass"]);
    expect(off.exitCode).toBe(0);
    expect(off.stdout.startsWith(OFF_LINE)).toBe(true);
    const r = await hook(root, [
      ...skillCall("gate", "sk1"),
      ...runRecords(root, r1),
      ...f,
      ...skillCall("gate", "sk2"),
      ...runRecords(root, r2),
      ...bashCall(rid("o"), outcomeCommand("gate-check", root, "pass"), off.stdout),
    ]);
    expect(r.exitCode).toBe(0);
  }, T);
});

describe("AC-STE-825.4 — a bun segment running the door with another verb is no outcome call (Z5-d)", () => {
  for (const verb of ["gate-check", "tdd", "--help"]) {
    test(`bun <door> ${verb} names no gate outcome`, () => {
      expect(namesGateOutcomeFor(`bun ${FRONT_DOOR} ${verb} /tmp/x`, GATE)).toBe(false);
      expect(namesGateOutcomeFor(`bun run ${door} ${verb} /tmp/x`, GATE)).toBe(false);
    });
  }
});

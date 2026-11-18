// STE-791 (M_d1e7b1) — fix round 1: the amended ACs .1, .2 and .3.
//
// AC .1 (addition): the one accepted `cd <dir> && bun [run] <path> <gate skill>` receipt
// form is read by the SAME recogniser in `pre-pr-spec-review` and
// `pre-commit-tdd-orchestrator`, driven here through the real hook wrappers. Each
// positive leg compares the cd-form transcript to the same transcript with the plain
// standalone form; each negative leg appends one segment after the receipt call.
//
// AC .2 (additions): a second `cd` operand, a program other than `bun`, and any
// whitespace or control character other than space and tab, each paired with the
// accepted base it was derived from. Plus the refute repro in a real tree: a cd dir
// whose name ends in U+00A0 that the shell enters while a lexical trim reads its
// sibling.
//
// AC .3 (amended): `bunInvocation` refuses the same seven characters; plain spaces
// and tabs around the command are still accepted.

import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  bashCall,
  cleanupTemps,
  FRONT_DOOR,
  type Hook,
  makeTree,
  mintRun,
  PLUGIN_ROOT,
  runHook,
  SHORT_OF,
  skillCall,
  SRC,
  stageCodeAndTest,
  tempDir,
  writeTranscript,
} from "./_m_7bc805_gate_outcome_fixture";

type AnyMod = Record<string, any>;
const T = 120_000;

afterAll(() => {
  cleanupTemps();
});

async function receiptModule(): Promise<AnyMod> {
  return (await import("../adapters/_shared/src/gate_receipt")) as AnyMod;
}

async function shellModule(): Promise<AnyMod> {
  return (await import("../adapters/_shared/src/shell_invocations")) as AnyMod;
}

const ABS = FRONT_DOOR;
/** A literal directory to `cd` into. */
const DIR = tempDir("791r1-cd");
/** The accepted base: `cd <literal dir> && bun run <absolute front door> gate-check <dir>`. */
const BASE = `cd ${DIR} && bun run ${ABS} gate-check ${DIR}`;
/** The accepted standalone base. */
const PLAIN = `bun run ${ABS} gate-check ${DIR}`;

/** The seven characters AC-STE-791.2 names, each with a readable label. */
const ODD_CHARS: ReadonlyArray<readonly [string, string]> = [
  ["U+00A0", " "],
  ["\\v (U+000B)", "\u000b"],
  ["\\f (U+000C)", "\u000c"],
  ["U+2028", " "],
  ["U+2029", " "],
  ["U+FEFF", "﻿"],
  ["U+200B", "​"],
];

// ------------------------------------------------------------------- AC .1

describe("AC-STE-791.1 — the cd form counts for the spec-review and tdd receipts too", () => {
  const HOOK_CASES: ReadonlyArray<{ hook: Hook; cd: (root: string) => string }> = [
    // spec-review: absolute front-door path under the cd.
    { hook: "pr", cd: (root) => `cd ${root} && bun ${ABS} spec-review ${root}` },
    // tdd: front-door path relative to the cd directory.
    { hook: "tdd", cd: (root) => `cd ${PLUGIN_ROOT} && bun adapters/_shared/src/gate_receipt.ts tdd ${root}` },
  ];

  for (const { hook, cd } of HOOK_CASES) {
    const skill = SHORT_OF[hook];

    test(
      `AC-STE-791.1 — ${hook} hook: the cd-form receipt is satisfied exactly as the standalone form`,
      async () => {
        const root = makeTree(`791r1-${hook}-pos`, "on");
        stageCodeAndTest(root);
        const run = mintRun(root, skill);
        const dir = tempDir("791r1-tr");
        const viaCd = writeTranscript(dir, [...skillCall(hook), ...bashCall("b0", cd(root), run.run.stdout)]);
        const plain = writeTranscript(dir, [
          ...skillCall(hook),
          ...bashCall("b0", `bun run ${ABS} ${skill} ${root}`, run.run.stdout),
        ]);
        const rCd = await runHook(hook, root, viaCd);
        const rPlain = await runHook(hook, root, plain);
        expect({ code: rPlain.exitCode, err: rPlain.stderr }).toEqual({ code: 0, err: "" });
        expect({ code: rCd.exitCode, err: rCd.stderr }).toEqual({ code: 0, err: "" });
      },
      T,
    );

    test(
      `AC-STE-791.1 — ${hook} hook: the same cd form with \`; echo ok\` appended is not counted`,
      async () => {
        const root = makeTree(`791r1-${hook}-neg`, "on");
        stageCodeAndTest(root);
        const run = mintRun(root, skill);
        const tr = writeTranscript(tempDir("791r1-tr"), [
          ...skillCall(hook),
          ...bashCall("b0", `${cd(root)}; echo ok`, `${run.run.stdout}ok\n`),
        ]);
        const r = await runHook(hook, root, tr);
        expect(r.exitCode).toBe(2);
      },
      T,
    );

    test(
      `AC-STE-791.1 — ${hook} hook: the same cd form with \`&& true\` appended is not counted`,
      async () => {
        const root = makeTree(`791r1-${hook}-neg2`, "on");
        stageCodeAndTest(root);
        const run = mintRun(root, skill);
        const tr = writeTranscript(tempDir("791r1-tr"), [
          ...skillCall(hook),
          ...bashCall("b0", `${cd(root)} && true`, run.run.stdout),
        ]);
        const r = await runHook(hook, root, tr);
        expect(r.exitCode).toBe(2);
      },
      T,
    );
  }
});

// ------------------------------------------------------------------- AC .2

/** The accepted base announces, and the shape derived from it does not. */
async function expectRejected(shape: string, base: string = BASE): Promise<void> {
  const m = await receiptModule();
  expect({ base: m.announcesGateReceipt(base), shape: m.announcesGateReceipt(shape) }).toEqual({ base: true, shape: false });
}

describe("AC-STE-791.2 — a cd with a second operand is refused", () => {
  test("AC-STE-791.2 — `cd <dir> extra && bun <front door> gate-check <root>`", async () => {
    await expectRejected(`cd ${DIR} extra && bun run ${ABS} gate-check ${DIR}`);
  });
  test("AC-STE-791.2 — `cd <dir> <dir> && bun …` (a second operand that is itself a directory)", async () => {
    await expectRejected(`cd ${DIR} ${DIR} && bun run ${ABS} gate-check ${DIR}`);
  });
});

describe("AC-STE-791.2 — a program other than bun after the cd is refused", () => {
  test("AC-STE-791.2 — `cd <dir> && node <abs front door> gate-check <root>`", async () => {
    await expectRejected(`cd ${DIR} && node ${ABS} gate-check ${DIR}`);
  });
  test("AC-STE-791.2 — `cd <dir> && bunx <abs front door> gate-check <root>`", async () => {
    await expectRejected(`cd ${DIR} && bunx ${ABS} gate-check ${DIR}`);
  });
});

describe("AC-STE-791.2 — whitespace or control characters other than space and tab are refused", () => {
  for (const [label, ch] of ODD_CHARS) {
    test(`AC-STE-791.2 — ${label} leading the cd command`, async () => {
      await expectRejected(`${ch}${BASE}`);
    });
    test(`AC-STE-791.2 — ${label} trailing the cd command`, async () => {
      await expectRejected(`${BASE}${ch}`);
    });
    test(`AC-STE-791.2 — ${label} inside the cd dir, right before \` &&\``, async () => {
      await expectRejected(`cd ${DIR}${ch} && bun run ${ABS} gate-check ${DIR}`);
    });
    test(`AC-STE-791.2 — ${label} leading the standalone command`, async () => {
      await expectRejected(`${ch}${PLAIN}`, PLAIN);
    });
    test(`AC-STE-791.2 — ${label} trailing the standalone command`, async () => {
      await expectRejected(`${PLAIN}${ch}`, PLAIN);
    });
  }

  test("AC-STE-791.2 — control: ordinary spaces and tabs around and inside the cd form still announce", async () => {
    const m = await receiptModule();
    expect(m.announcesGateReceipt(` \t${`cd ${DIR}\t&&  bun run ${ABS}\tgate-check ${DIR}`} \t`)).toBe(true);
  });
});

// The refute repro: the shell splits words on space, tab and newline only, so it enters
// `d<U+00A0>` and runs the forged script there, while a reader that trims the NBSP grades
// `d`, whose `src` is a symlink to the real front door's directory.
describe("AC-STE-791.2 — the NBSP sibling-dir forgery (real tree)", () => {
  const root = realpathSync(tempDir("791r1-nbsp"));
  const d = join(root, "d");
  mkdirSync(d, { recursive: true });
  symlinkSync(SRC, join(d, "src"));
  const nbspDir = join(root, "d ");
  mkdirSync(join(nbspDir, "src"), { recursive: true });
  writeFileSync(join(nbspDir, "src", "gate_receipt.ts"), 'console.log("dpt-receipt: FORGED-BY-NBSP-SIBLING");\n');
  const command = `cd ${d}  && bun src/gate_receipt.ts gate-check .`;
  const honest = `cd ${d} && bun src/gate_receipt.ts gate-check .`;

  test("AC-STE-791.2 — `cd <abs>/d<U+00A0> && bun src/gate_receipt.ts gate-check .` announces nothing", async () => {
    await expectRejected(command, honest);
  });

  test("AC-STE-791.2 — premise: the shell enters the NBSP dir and runs the forged script", () => {
    const p = spawnSync("/bin/bash", ["-c", command], { encoding: "utf-8", cwd: root });
    expect(p.stdout).toContain("FORGED-BY-NBSP-SIBLING");
  });
});

// ------------------------------------------------------------------- AC .3

describe("AC-STE-791.3 — bunInvocation refuses the same seven characters", () => {
  const PLAIN_X = `bun ${ABS} gate-check /x`;

  for (const [label, ch] of ODD_CHARS) {
    test(`AC-STE-791.3 — ${label} leading the command`, async () => {
      const s = await shellModule();
      expect(s.bunInvocation(`${ch}${PLAIN_X}`)).toBeNull();
    });
    test(`AC-STE-791.3 — ${label} trailing the command`, async () => {
      const s = await shellModule();
      expect(s.bunInvocation(`${PLAIN_X}${ch}`)).toBeNull();
    });
    test(`AC-STE-791.3 — ${label} inside the module path`, async () => {
      const s = await shellModule();
      expect(s.bunInvocation(`bun ${SRC}/${ch}gate_receipt.ts gate-check /x`)).toBeNull();
    });
  }

  test("AC-STE-791.3 — control: ordinary leading and trailing spaces and tabs are still accepted", async () => {
    const s = await shellModule();
    expect(s.bunInvocation(` \t ${PLAIN_X}\t \t`)).toEqual({ module: s.realpathOr(ABS), args: ["gate-check", "/x"] });
  });
});

// Fix round 1: the helper's own contract, so the refusal is pinned even where the
// word splitter would also refuse the character (mutation 791-a2 otherwise survives).
describe("AC-STE-791.3 — trimShellBlanks trims only space and tab and refuses every other blank", () => {
  test("each refused character, anywhere, yields null; space and tab are trimmed", async () => {
    const { trimShellBlanks } = (await import("../adapters/_shared/src/shell_invocations")) as Record<string, any>;
    for (const ch of [" ", "\v", "\f", " ", " ", "﻿", "​", "\n", "\r"]) {
      expect({ ch, lead: trimShellBlanks(`${ch}bun x`), mid: trimShellBlanks(`bun${ch}x`), tail: trimShellBlanks(`bun x${ch}`) }).toEqual({
        ch,
        lead: null,
        mid: null,
        tail: null,
      });
    }
    expect(trimShellBlanks(" \tbun x\t ")).toBe("bun x");
  });
});

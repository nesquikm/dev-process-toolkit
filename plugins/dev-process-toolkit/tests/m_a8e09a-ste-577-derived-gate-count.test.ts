// STE-577 — the blocking-gate count is derived, not typed.
//
// Two sibling suites decide their "every gate" roll-ups by comparing a
// hand-typed array against the literal three:
//
//   m_a41431-ste-571-consumer-chains.test.ts   `HOOKS.length === 3 && …`
//   m_a41431-ste-572-manual-reachable.test.ts  `GATES.length === 3 && …`
//
// A reader that DERIVES the set from the hook entry points already ships beside
// them at `tests/_blocking_gates.ts`, and neither suite consults it. A fourth
// blocking gate lands and both suites stay green — measured, not argued: see
// the AC.7 leg below, which records the pre-change numbers.
//
// WHAT THIS FILE GRADES, and why it is two kinds of assertion.
//
//   1. SOURCE-LEVEL. Whether each suite imports the reader, binds it once, and
//      carries an agreement test FIRST with a non-empty guard and a message
//      naming the entry-point directory. These are shape demands (AC.1–AC.4)
//      that a behavioural run cannot see: a suite could red under the mutation
//      from the bottom of its output with no message worth reading, and satisfy
//      "reds both suites" while failing every AC that says how it should red.
//
//   2. BEHAVIOURAL. Whether a real fourth gate — entry point, shell shim and
//      registry entry — actually reds both suites when they are RUN. The
//      mutation is applied to a staged COPY of the repository, never to the
//      live tree: `tests/bundled-hooks-shape.test.ts` pins the hooks.json entry
//      counts, and a live-tree mutation would red a file this FR does not name.
//
// The reader inspects entry-point SOURCES and never opens `hooks/hooks.json`,
// so a registry-only mutation is invisible to it and a suite that stayed green
// under one would read as evidence that the finding was false. The mutation
// here is all three pieces, which is what makes its green (before) and its red
// (after) mean the thing the FR claims.
//
// THE POSITIONAL TRAP, and it is this FR's own subject recurring. The hand-kept
// arrays are NOT replaced by the derived set, and AC.5 pins why:
// `m_a41431-ste-572-manual-reachable.test.ts` binds `GATES[0]` to
// `skills/gate-check/SKILL.md` and `GATES[1]` to `skills/pr/SKILL.md` BY INDEX,
// while `deriveBlockingGates` returns its set name-sorted. A drop-in
// substitution would silently regrade the wrong skill file and stay green.

import { afterAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ORDERED_UNREACHABLE_PIN,
  ORDERED_UNREACHABLE_PIN_LEDGER,
} from "../adapters/_shared/src/module_reachability";
import { deriveBlockingGates, type BlockingGate } from "./_blocking_gates";
import { mutate } from "./_fence";

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(pluginRoot, "..", "..");
const read = (p: string) => readFileSync(p, "utf-8");

const TESTS_DIR = join(pluginRoot, "tests");
const GATE_CHECK_SKILL = join(pluginRoot, "skills", "gate-check", "SKILL.md");

/**
 * The entry-point directory, spelled as the suites must spell it in a failure
 * message. AC.2 asks the red run to name the file to open; a message that says
 * "the lists disagree" and stops sends the reader nowhere.
 */
const HOOKS_DIR_REL = "templates/hooks/_lib/hooks";
const HOOKS_DIR = join(pluginRoot, ...HOOKS_DIR_REL.split("/"));

/**
 * The value the down-only module-reachability pin carried when this FR landed.
 * A FROZEN historical ceiling, never an equality: the pin may fall, it may
 * never rise, and AC.9 is a statement about the ceiling and nothing else.
 */
const PIN_FROZEN_AT = 129;

/** The two suites under test, with the name each gives its hand-kept array. */
const SUITES = [
  { label: "m_a41431-ste-571-consumer-chains.test.ts", handKept: "HOOKS" },
  { label: "m_a41431-ste-572-manual-reachable.test.ts", handKept: "GATES" },
] as const;

const suitePath = (label: string) => join(TESTS_DIR, label);
const suiteBody = (label: string) => read(suitePath(label));

/** The derived subject. Never a literal list — that is the FR. */
const gates = (): BlockingGate[] => deriveBlockingGates(pluginRoot);

// ---------------------------------------------------------------------------
// Source readers. Every one is PURE OVER A BODY STRING, so the same reader
// grades the landed suites and any staged copy of them.
// ---------------------------------------------------------------------------

/** Does the body import the derived reader from its shipped module? */
const importsDerivedReader = (body: string): boolean =>
  /import\s*\{[^}]*\bderiveBlockingGates\b[^}]*\}\s*from\s*["']\.\/_blocking_gates["']/.test(
    body,
  );

/** Every `deriveBlockingGates(` CALL in the body — the import is not a call. */
const derivationCallSites = (body: string): number =>
  [...body.matchAll(/deriveBlockingGates\s*\(/g)].length;

/**
 * The `const <name> = deriveBlockingGates(<arg>)` binding, or null.
 *
 * A direct const binding rather than a thunk, because AC.1 says the set is
 * computed ONCE from the plugin root: `() => deriveBlockingGates(pluginRoot)`
 * has one call site in the source and N evaluations at run time, and the AC is
 * about the second number.
 */
function derivedBinding(body: string): { name: string; arg: string } | null {
  const m =
    /const\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]*)?=\s*deriveBlockingGates\(\s*([A-Za-z_$][\w$]*)\s*\)/.exec(
      body,
    );
  return m === null ? null : { name: m[1]!, arg: m[2]! };
}

/** A roll-up that compares the hand-kept length against a LITERAL. */
const literalRollUp = (handKept: string): RegExp =>
  new RegExp(`\\b${handKept}\\.length\\s*===\\s*\\d+`);

/** A roll-up that compares the hand-kept length against the derived length. */
const derivedRollUp = (handKept: string, derived: string): RegExp =>
  new RegExp(
    `\\b${handKept}\\.length\\s*===\\s*${derived}\\.length` +
      `|\\b${derived}\\.length\\s*===\\s*${handKept}\\.length`,
  );

/** Openers, so the first test can be sliced off at the next block. */
const TEST_OPENER = /^[ \t]*test\(/gm;
const BLOCK_OPENER = /^[ \t]*(?:test|describe)\(/gm;

/**
 * The source of the FIRST `test(` block in a file.
 *
 * Sliced to the next `test(` or `describe(` opener rather than brace-matched:
 * the only question asked of the slice is what it MENTIONS, and a slice that
 * ran one line long would answer that question identically. Returns "" when
 * the file declares no test at all, which the zero-hit guard rules out.
 */
function firstTestBlock(body: string): string {
  const first = [...body.matchAll(TEST_OPENER)].map((m) => m.index!)[0];
  if (first === undefined) return "";
  const next = [...body.matchAll(BLOCK_OPENER)]
    .map((m) => m.index!)
    .find((i) => i > first);
  return body.slice(first, next ?? body.length);
}

/** A guard that the derived set is non-empty, in either sanctioned spelling. */
const NON_EMPTY_GUARD = /toBeGreaterThan\(\s*0\s*\)|toBeGreaterThanOrEqual\(\s*1\s*\)/;

/**
 * The hand-kept gate names, in SOURCE ORDER.
 *
 * Read out of the array literal rather than imported, because the point of
 * AC.5 is that the literal is still there and still in that order — a reader
 * that imported the value could not tell a literal from a substitution.
 */
function handKeptNames(body: string, constName: string): string[] {
  const start = body.indexOf(`const ${constName}`);
  if (start === -1) return [];
  const end = body.indexOf("] as const", start);
  if (end === -1) return [];
  return [...body.slice(start, end).matchAll(/name:\s*"([^"]+)"/g)].map((m) => m[1]!);
}

/** The order the two hand-kept arrays carry today, and must keep carrying. */
const FROZEN_HAND_KEPT_ORDER = [
  "pre-commit-gate-check",
  "pre-pr-spec-review",
  "pre-commit-tdd-orchestrator",
] as const;

// ---------------------------------------------------------------------------
// The staged mutation harness.
//
// A mutation is only evidence when the thing it reds is the thing the control
// greens, so every leg stages an UNMUTATED copy first and measures it. Nothing
// here writes to a repository file.
// ---------------------------------------------------------------------------

const SYNTHETIC_HOOK = "pre-push-bathymetry-audit";
const SYNTHETIC_SKILL = "dev-process-toolkit:bathymetry";

/** The shipped blocking shape, verbatim in structure, with novel names. */
const SYNTHETIC_ENTRY_POINT = `// Synthetic fourth blocking entry point — AC-STE-577.6 fixture.

import { parseHookPayload, requireSkillToolUse } from "../session.ts";

const stdin = await Bun.stdin.text();
const payload = parseHookPayload(stdin);
if (!payload) {
  process.exit(0);
}
const cmd = payload.tool_input?.command ?? "";
if (!/^git push\\b/.test(cmd)) {
  process.exit(0);
}
const { found } = requireSkillToolUse(
  "${SYNTHETIC_SKILL}",
  "${SYNTHETIC_HOOK}",
  payload,
);
process.exit(found ? 0 : 2);
`;

const SYNTHETIC_SHIM = `#!/usr/bin/env bash
exec bun run "\${CLAUDE_PLUGIN_ROOT}/templates/hooks/_lib/hooks/${SYNTHETIC_HOOK}.ts"
`;

const tempRoots: string[] = [];

/**
 * A throwaway REPOSITORY root the two suites can be run from.
 *
 * The whole plugin tree, plus the three repo-root files the suites and the
 * public-surface probe read. `node_modules` is symlinked rather than copied:
 * the staged suites resolve their imports from the staged path, and a root
 * without one would fail to load for a reason that has nothing to do with a
 * gate. Measured at ~25ms for the copy, so the legs below can afford one stage
 * each rather than sharing a mutated tree.
 */
function stageRepo(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `ste-577-${label}-`));
  tempRoots.push(root);
  cpSync(join(repoRoot, "plugins"), join(root, "plugins"), { recursive: true });
  for (const f of ["README.md", "CLAUDE.md", "package.json"]) {
    const src = join(repoRoot, f);
    if (existsSync(src)) cpSync(src, join(root, f));
  }
  const modules = join(repoRoot, "node_modules");
  if (existsSync(modules)) symlinkSync(modules, join(root, "node_modules"), "dir");
  return root;
}

const stagedPluginRoot = (root: string) => join(root, "plugins", "dev-process-toolkit");
const stagedHooksDir = (root: string) =>
  join(stagedPluginRoot(root), ...HOOKS_DIR_REL.split("/"));

interface SuiteRun {
  readonly pass: number;
  readonly fail: number;
  readonly exitCode: number;
  readonly output: string;
}

/** Run ONE suite inside a staged root and read its counts back. */
function runSuite(root: string, label: string): SuiteRun {
  const cwd = stagedPluginRoot(root);
  const proc = Bun.spawnSync([process.execPath, "test", join("tests", label)], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const output = `${proc.stdout.toString()}${proc.stderr.toString()}`;
  const pass = Number(/(\d+)\s+pass/.exec(output)?.[1] ?? "-1");
  const fail = Number(/(\d+)\s+fail/.exec(output)?.[1] ?? "-1");
  return { pass, fail, exitCode: proc.exitCode ?? -1, output };
}

/**
 * Both suites red, and red for a reason the suite itself raised.
 *
 * `pass` is asserted non-zero too: a staged tree whose suite failed to LOAD
 * reports zero passes and a non-zero exit, which is indistinguishable from a
 * mutation the suite caught unless the run is asked to show it still ran.
 */
function expectBothSuitesRed(root: string, because: string): void {
  for (const { label } of SUITES) {
    const run = runSuite(root, label);
    expect(
      run.fail,
      `${label} stayed green under ${because}\n${run.output.slice(0, 2000)}`,
    ).toBeGreaterThan(0);
    expect(
      run.pass,
      `${label} reported no passing test under ${because} — it failed to load, ` +
        `which is not the same as catching the mutation\n${run.output.slice(0, 2000)}`,
    ).toBeGreaterThan(0);
    expect(run.exitCode, `${label} exited 0 while reporting failures`).not.toBe(0);
  }
}

/** Both suites green — the control every mutation leg is measured against. */
function expectBothSuitesGreen(root: string, what: string): void {
  for (const { label } of SUITES) {
    const run = runSuite(root, label);
    expect(
      run.fail,
      `${label} is not green on ${what}\n${run.output.slice(0, 2000)}`,
    ).toBe(0);
    expect(
      run.pass,
      `${label} ran no tests on ${what} — the stage is broken, not clean`,
    ).toBeGreaterThan(10);
  }
}

afterAll(() => {
  // Never a repository file: every mutation above writes into a temp copy.
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

// ===========================================================================
// Zero-hit guards — every reader is pointed at a real surface, so a silently
// empty extraction fails loudly here instead of quietly satisfying an
// assertion further down.
// ===========================================================================

describe("the readers are pointed at the surfaces this FR governs", () => {
  test("both suites are real, non-trivial, and carry their hand-kept array", () => {
    for (const { label, handKept } of SUITES) {
      const body = suiteBody(label);
      expect(body.length, label).toBeGreaterThan(5000);
      expect(body, `${label} no longer declares ${handKept}`).toContain(
        `const ${handKept}`,
      );
      expect(handKeptNames(body, handKept), `${label}: no names parsed`).toHaveLength(3);
      expect([...body.matchAll(TEST_OPENER)].length, `${label}: no tests parsed`)
        .toBeGreaterThan(5);
      expect(firstTestBlock(body), `${label}: the first-test slicer found nothing`)
        .not.toBe("");
    }
  });

  test("the derived reader answers a non-empty set over the landed tree", () => {
    expect(existsSync(HOOKS_DIR), `${HOOKS_DIR_REL} is missing`).toBe(true);
    const live = gates();
    expect(live.length, "the derivation returned nothing to grade against").toBeGreaterThan(
      0,
    );
    // The reader is name-sorted; that is what makes AC.5's trap real.
    expect([...live].map((g) => g.hook)).toEqual(
      [...live].map((g) => g.hook).sort(),
    );
  });

  test("the synthetic gate's names appear nowhere in either suite", () => {
    for (const { label } of SUITES) {
      const body = suiteBody(label);
      expect(body, `${label} already mentions the synthetic hook`).not.toContain(
        SYNTHETIC_HOOK,
      );
      expect(body, `${label} already mentions the synthetic skill`).not.toContain(
        SYNTHETIC_SKILL,
      );
    }
  });
});

// ===========================================================================
// AC-STE-577.1 — the reader is imported, bound once, and grades the roll-up
// ===========================================================================

describe("AC-STE-577.1 — the roll-ups compare against the derived length", () => {
  for (const { label, handKept } of SUITES) {
    test(`${label} imports deriveBlockingGates from ./_blocking_gates`, () => {
      expect(
        importsDerivedReader(suiteBody(label)),
        `${label} does not import the derived reader that ships at tests/_blocking_gates.ts`,
      ).toBe(true);
    });

    test(`${label} computes the derived set ONCE, from the plugin root`, () => {
      const body = suiteBody(label);
      const binding = derivedBinding(body);
      expect(
        binding,
        `${label} has no \`const … = deriveBlockingGates(<root>)\` binding`,
      ).not.toBeNull();
      expect(
        binding!.arg,
        `${label} derives from \`${binding?.arg}\` rather than the plugin root`,
      ).toBe("pluginRoot");
      expect(
        derivationCallSites(body),
        `${label} calls deriveBlockingGates ${derivationCallSites(body)} times — AC.1 says once`,
      ).toBe(1);
    });

    test(`${label} no longer compares ${handKept}.length against a literal`, () => {
      const body = suiteBody(label);
      const hit = literalRollUp(handKept).exec(body);
      expect(
        hit?.[0] ?? null,
        `${label} still gates a roll-up on a typed count: \`${hit?.[0]}\``,
      ).toBeNull();
    });

    test(`${label}'s roll-up compares ${handKept}.length against the derived length`, () => {
      const body = suiteBody(label);
      const binding = derivedBinding(body);
      expect(binding, `${label}: nothing derived to compare against`).not.toBeNull();
      expect(
        derivedRollUp(handKept, binding!.name).test(body),
        `${label}: no roll-up compares ${handKept}.length with ${binding?.name}.length`,
      ).toBe(true);
    });
  }
});

// ===========================================================================
// AC-STE-577.2 — an agreement test, compared as sorted collections
// ===========================================================================

describe("AC-STE-577.2 — each suite grades its list against the derived set", () => {
  for (const { label, handKept } of SUITES) {
    test(`${label} carries an agreement test naming both collections`, () => {
      const body = suiteBody(label);
      const block = firstTestBlock(body);
      const binding = derivedBinding(body);
      expect(binding, `${label}: nothing derived`).not.toBeNull();
      expect(
        block,
        `${label}: the agreement test does not name the hand-kept ${handKept}`,
      ).toContain(handKept);
      expect(
        block,
        `${label}: the agreement test does not name the derived ${binding?.name}`,
      ).toContain(binding!.name);
    });

    test(`${label}'s agreement test compares SORTED collections, and skills too`, () => {
      const block = firstTestBlock(suiteBody(label));
      // `/sort/i` rather than `/\.sort\(/`: a helper named `sortedNames` is a
      // perfectly good way to do this, and a grep that only admitted the inline
      // spelling would push the fix into a shape to satisfy the grep. What the
      // sorted comparison actually BUYS is proved by leg (c) below, which
      // renames a gate without changing the count.
      expect(
        /sort/i.test(block),
        `${label}: the agreement test compares positionally — the derived set is ` +
          `name-sorted and the hand-kept array is not, so a positional compare ` +
          `either reds on a healthy tree or is written to ignore the difference`,
      ).toBe(true);
      expect(
        /skill/i.test(block),
        `${label}: the agreement test grades gate names but not demanded skills`,
      ).toBe(true);
    });

    test(`${label}'s agreement failure names the hook entry-point directory`, () => {
      const block = firstTestBlock(suiteBody(label));
      expect(
        block,
        `${label}: a red agreement test would not tell the reader that ` +
          `${HOOKS_DIR_REL} is the tree to open`,
      ).toContain(HOOKS_DIR_REL);
    });
  }
});

// ===========================================================================
// AC-STE-577.3 — the agreement test runs FIRST
// ===========================================================================

describe("AC-STE-577.3 — a fourth gate reds at the top of the output", () => {
  for (const { label, handKept } of SUITES) {
    test(`the FIRST test in ${label} is the agreement test`, () => {
      const body = suiteBody(label);
      const binding = derivedBinding(body);
      expect(binding, `${label}: nothing derived`).not.toBeNull();
      const block = firstTestBlock(body);
      const title = /test\(\s*(["'`])([\s\S]*?)\1/.exec(block)?.[2] ?? "";
      expect(
        block.includes(binding!.name) && block.includes(handKept),
        `${label}: the first test is "${title}" — the agreement test is buried ` +
          `below it, so a fourth gate reds among collateral failures`,
      ).toBe(true);
    });
  }
});

// ===========================================================================
// AC-STE-577.4 — the agreement test refuses to pass against nothing
// ===========================================================================

describe("AC-STE-577.4 — the agreement test is guarded against an empty set", () => {
  for (const { label } of SUITES) {
    test(`${label}'s agreement test asserts the derived set is non-empty`, () => {
      const body = suiteBody(label);
      const block = firstTestBlock(body);
      const binding = derivedBinding(body);
      expect(binding, `${label}: nothing derived`).not.toBeNull();
      expect(
        NON_EMPTY_GUARD.test(block),
        `${label}: an unreadable hook tree yields an empty derived set, and an ` +
          `agreement check against nothing passes vacuously — the agreement test ` +
          `carries no non-empty guard on ${binding?.name}`,
      ).toBe(true);
    });
  }

  test("MECHANISM — an absent hook tree really does yield an empty set", () => {
    // Not a claim about the suites: a claim about the state AC.4 guards against.
    // If this ever stopped being true the guard would be guarding nothing.
    const void_ = mkdtempSync(join(tmpdir(), "ste-577-void-"));
    tempRoots.push(void_);
    expect(deriveBlockingGates(void_)).toEqual([]);
  });
});

// ===========================================================================
// AC-STE-577.5 — the hand-kept arrays SURVIVE, in their present order
//
// This is the leg that stops the fix from reproducing the defect it fixes.
// ===========================================================================

describe("AC-STE-577.5 — the hand-kept arrays are graded, not replaced", () => {
  for (const { label, handKept } of SUITES) {
    test(`${label} still declares ${handKept} as a literal array`, () => {
      const body = suiteBody(label);
      const start = body.indexOf(`const ${handKept}`);
      expect(start, `${label} no longer declares ${handKept}`).toBeGreaterThan(-1);
      const close = body.indexOf("] as const", start);
      const decl = body.slice(start, close === -1 ? start + 400 : close);
      expect(
        decl,
        `${label}: ${handKept} was replaced by the derived set — the index-bound ` +
          `entries below would then regrade the wrong file, silently`,
      ).not.toContain("deriveBlockingGates");
      expect(decl).toContain("[");
    });

    test(`${handKept}'s element order in ${label} is unchanged`, () => {
      expect(handKeptNames(suiteBody(label), handKept), label).toEqual([
        ...FROZEN_HAND_KEPT_ORDER,
      ]);
    });
  }

  test("the two index-bound entries still name the skills they name today", () => {
    const body = suiteBody("m_a41431-ste-572-manual-reachable.test.ts");
    const lineFor = (skillFile: string) =>
      body.split("\n").find((l) => l.includes(`label: "${skillFile}"`)) ?? "";

    const prLine = lineFor("skills/pr/SKILL.md");
    const gateLine = lineFor("skills/gate-check/SKILL.md");
    expect(prLine, "the skills/pr point-of-use row is gone").not.toBe("");
    expect(gateLine, "the skills/gate-check point-of-use row is gone").not.toBe("");
    expect(prLine, "skills/pr/SKILL.md is no longer graded against GATES[1]").toContain(
      "GATES[1]",
    );
    expect(
      gateLine,
      "skills/gate-check/SKILL.md is no longer graded against GATES[0]",
    ).toContain("GATES[0]");

    // And the index those rows point at still names the gate they document.
    const names = handKeptNames(body, "GATES");
    expect(names[1], "GATES[1] no longer names the /pr gate").toBe("pre-pr-spec-review");
    expect(names[0], "GATES[0] no longer names the /gate-check gate").toBe(
      "pre-commit-gate-check",
    );
  });

  test("THE TRAP IS REAL — the derived order disagrees with the hand-kept order", () => {
    // The reason AC.5 exists, asserted rather than asserted-about. If these two
    // orders ever coincided, a substitution would be harmless and this pin would
    // be guarding a danger that no longer exists — which is worth knowing too.
    const derivedNames = gates().map((g) => g.hook);
    const kept = [...FROZEN_HAND_KEPT_ORDER];
    expect(derivedNames.slice().sort()).toEqual(kept.slice().sort());
    expect(
      derivedNames[1],
      "the derived set and the hand-kept array now agree positionally — " +
        "re-read AC.5 before relaxing anything on the strength of it",
    ).not.toBe(kept[1]);
  });
});

// ===========================================================================
// AC-STE-577.6 — falsifiability, both directions, against the RUNNING suites
//
// Every leg measures an unmutated staged copy CLEAN first, so a red below is
// the mutation and not the staging.
// ===========================================================================

describe("AC-STE-577.6 — the suites are mutation-tested by running them", () => {
  test("CONTROL — both suites are green on an unmutated staged copy", () => {
    const control = stageRepo("control");
    expect(deriveBlockingGates(stagedPluginRoot(control))).toEqual(gates());
    expectBothSuitesGreen(control, "an unmutated staged copy");
  }, 180_000);

  test("(a) A REAL FOURTH GATE — entry point, shim and registry — reds both suites", () => {
    const root = stageRepo("fourth");
    const plugin = stagedPluginRoot(root);

    // 1. Entry point — the only piece the derived reader can see.
    writeFileSync(join(stagedHooksDir(root), `${SYNTHETIC_HOOK}.ts`), SYNTHETIC_ENTRY_POINT);

    // 2. Shell shim, as every shipped gate carries.
    const shim = join(plugin, "templates", "hooks", "process", `${SYNTHETIC_HOOK}.sh`);
    writeFileSync(shim, SYNTHETIC_SHIM);
    chmodSync(shim, 0o755);

    // 3. Registry entry. Invisible to the reader BY DESIGN — a registry-only
    //    mutation changes nothing it can see — and included because the AC asks
    //    for a real gate rather than a file that looks like one.
    const registryPath = join(plugin, "hooks", "hooks.json");
    const registry = JSON.parse(read(registryPath));
    registry.hooks.PreToolUse[0].hooks.push({
      type: "command",
      command: `"\${CLAUDE_PLUGIN_ROOT}"/templates/hooks/process/${SYNTHETIC_HOOK}.sh`,
      timeout: 5000,
    });
    writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`);
    expect(read(registryPath), "the registry mutation did not land").toContain(
      SYNTHETIC_HOOK,
    );

    // The reader sees four, which is what the suites must now notice.
    const derived = deriveBlockingGates(plugin);
    expect(
      derived.length,
      "the staged fourth gate is invisible to the derivation — the fixture is wrong",
    ).toBe(gates().length + 1);
    expect(derived.find((g) => g.hook === SYNTHETIC_HOOK)?.skill).toBe(SYNTHETIC_SKILL);

    expectBothSuitesRed(root, "a real fourth blocking gate");
  }, 180_000);

  test("(b) REMOVING an existing gate's entry point reds both suites", () => {
    const root = stageRepo("removed");
    const removed = "pre-pr-spec-review";
    const entry = join(stagedHooksDir(root), `${removed}.ts`);
    expect(existsSync(entry), "the fixture removed a file that was not there").toBe(true);
    rmSync(entry);

    const derived = deriveBlockingGates(stagedPluginRoot(root));
    expect(derived.map((g) => g.hook)).not.toContain(removed);
    expect(derived.length).toBe(gates().length - 1);

    expectBothSuitesRed(root, "an entry point removed from under the hand-kept list");
  }, 180_000);

  test("(c) RENAMING a gate keeps the count and still reds both suites", () => {
    // The direction a bare count comparison cannot see, and the reason AC.2 asks
    // for sorted NAME collections rather than lengths.
    const root = stageRepo("renamed");
    const entry = join(stagedHooksDir(root), "pre-commit-gate-check.ts");
    const source = read(entry);
    writeFileSync(
      entry,
      mutate(source, '"pre-commit-gate-check",', '"pre-commit-gate-inspection",'),
    );

    const derived = deriveBlockingGates(stagedPluginRoot(root));
    expect(derived.length, "the rename changed the count — it is not a swap").toBe(
      gates().length,
    );
    expect(derived.map((g) => g.hook)).toContain("pre-commit-gate-inspection");

    expectBothSuitesRed(root, "a gate renamed under the hand-kept list");
  }, 180_000);
});

// ===========================================================================
// AC-STE-577.7 — the mutation is proved to BE a mutation
//
// MEASURED BEFORE THE CHANGE, on the tree this FR arrived at:
//
//   fourth-gate mutation applied → 76 pass / 0 fail across both suites
//   entry-point removal applied  → 76 pass / 0 fail across both suites
//   unmutated staged control     → 76 pass / 0 fail across both suites
//
// Byte-identical to the control in both directions. That is the finding: a real
// fourth gate lands and the two suites that exist to notice do not.
//
// The recording above cannot be re-run once the suites are fixed, so the claim
// is also encoded as a live assertion below: on the SAME mutated tree, the
// predicate shape the suites carried before this FR stays satisfied while the
// shape they carry after it fails. A mutation that never applied could not
// separate the two.
// ===========================================================================

describe("AC-STE-577.7 — the old shape survives the mutation the new shape catches", () => {
  test("the literal-3 roll-up greens on a four-gate tree; the derived one reds", () => {
    const root = stageRepo("proof");
    writeFileSync(join(stagedHooksDir(root), `${SYNTHETIC_HOOK}.ts`), SYNTHETIC_ENTRY_POINT);
    const derived = deriveBlockingGates(stagedPluginRoot(root));

    // The mutation applied, and the reader can see it.
    expect(derived.length, "the mutation did not apply").toBe(gates().length + 1);

    // The hand-kept lists are read from the SUITES, not restated here: a
    // literal would make the two clauses below true of a constant in this file
    // rather than of the arrays the FR is about.
    for (const { label, handKept: constName } of SUITES) {
      const handKept = handKeptNames(suiteBody(label), constName);
      expect(handKept.length, `${label}: no hand-kept names parsed`).toBeGreaterThan(0);

      // The shape both suites carried BEFORE this FR. A new entry point does
      // not touch a typed array, so the literal comparison is still satisfied.
      expect(
        handKept.length === 3,
        `${label}: the pre-change roll-up did not survive the mutation — then it ` +
          `was never the shape this FR is replacing`,
      ).toBe(true);

      // The shape AC.1 requires AFTER it.
      expect(
        handKept.length === derived.length,
        `${label}: the derived roll-up survived a fourth gate — it is not derived`,
      ).toBe(false);

      // And the sorted-name comparison AC.2 requires fails too, which is the
      // clause that also catches a same-count rename.
      expect(handKept.slice().sort()).not.toEqual(derived.map((g) => g.hook).sort());
    }
  }, 180_000);
});

// ===========================================================================
// AC-STE-577.8 — the false provenance comment is gone
// ===========================================================================

describe("AC-STE-577.8 — no suite claims the list was measured from the registry", () => {
  for (const { label } of SUITES) {
    test(`${label} does not claim its list came from hooks.json`, () => {
      const body = suiteBody(label);
      // Both alternatives are anchored to the FALSE claim, not to a phrase
      // that appears inside it. A bare /not derived/i would match any line
      // using those two words correctly — including one explaining that the
      // list is graded against the derived set — which is an assertion wider
      // than its own subject, the thing this whole FR is about. So the second
      // alternative requires the claim's actual shape: "not derived" as a
      // trailing disclaimer on a provenance sentence.
      const offending = body
        .split("\n")
        .filter(
          (l) =>
            /measured from[^\n]*hooks\.json/i.test(l) ||
            /,\s*not derived\b/i.test(l),
        );
      expect(
        offending,
        `${label} still carries a false provenance claim: the list is typed, and ` +
          `the registry is not what it was read from`,
      ).toEqual([]);
    });
  }
});

// ===========================================================================
// AC-STE-577.9 — this FR moves neither the probe count nor the pin
// ===========================================================================

describe("AC-STE-577.9 — no probe, no ordered module", () => {
  test("the /gate-check probe registry is unmoved", () => {
    // DERIVED, never restated: the count already has three homes, and planting a
    // fourth in the suite that guards against typed counts would be this FR
    // doing its own trick. Same mechanism as the sibling suites use.
    const registry = read(GATE_CHECK_SKILL);
    const registrations = registry.split("\n").flatMap((line) => {
      const m = /^(\d+)\. \*\*/.exec(line);
      return m === null ? [] : [Number(m[1])];
    });
    expect(registrations.length).toBeGreaterThan(50);
    expect(
      registrations,
      `the registry numbering is not a gapless 1..${registrations.length} run`,
    ).toEqual(Array.from({ length: registrations.length }, (_, i) => i + 1));

    const observed = (registry.match(/^\d+[a-z]?\. \*\*/gm) ?? []).length;
    expect(observed).toBe(registrations.length);
    const overview = read(join(pluginRoot, "docs", "workflow-overview.md"));
    expect(
      overview,
      `measured ${observed} probe registrations — docs/workflow-overview.md states a different count`,
    ).toContain(`typecheck + lint + tests + ${observed} probes`);
    expect(overview).toContain(`| ${observed} conformance probes (NFR-15) |`);
  });

  test("ORDERED_UNREACHABLE_PIN is unmoved, and is the ledger head", () => {
    // DOWN-ONLY. `toBe(<literal>)` is forbidden tree-wide; the sanctioned way to
    // say "never raised" is a bound against a frozen historical value.
    expect(
      ORDERED_UNREACHABLE_PIN,
      `the pin rose above ${PIN_FROZEN_AT} — this FR adds no ordered unreachable module`,
    ).toBeLessThanOrEqual(PIN_FROZEN_AT);
    expect(ORDERED_UNREACHABLE_PIN).toBe(ORDERED_UNREACHABLE_PIN_LEDGER[0]!.value);
  });

  test("THE MECHANISM — this FR ships no new adapter module and no new probe", () => {
    // Asserting the mechanism is stronger than asserting the numbers: the pin
    // counts ORDERED references to modules nothing runnable reaches, and this
    // FR's only new file is a `*.test.ts` that no markdown names.
    for (const { label } of SUITES) {
      expect(suiteBody(label), `${label} registers a probe`).not.toMatch(
        /^\d+\. \*\*/m,
      );
    }
    expect(existsSync(join(pluginRoot, "adapters", "_shared", "src", "blocking_gates.ts")))
      .toBe(false);
  });
});

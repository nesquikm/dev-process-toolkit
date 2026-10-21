// STE-686 — AC-STE-686.10: removing each new bound, the SIGKILL escalation, or
// a naming step reddens a test.
//
//   MUTANT 1. The spawn_receipt front door's ownership spawn loses `timeout:`.
//   MUTANT 2. The same spawn loses `killSignal: "SIGKILL"` — the TERM-ignoring
//             check then outlives its bound.
//   MUTANT 3. `runTypedoc` loses `timeout:`.
//   MUTANT 4. `runAssertion` loses `timeout:`.
//   MUTANT 5. `gate_identity_run.ts` loses its SIGKILL escalation — every
//             `"SIGKILL"` in it becomes `"SIGTERM"`, so a TERM-ignoring gate
//             run outlives its bound (AC-STE-686.9).
//   MUTANT 6. `gate_identity_run.ts`'s supervisor signals the direct child pid
//             instead of its process group — on the bun stack's `/bin/sh -c`
//             arm the TERM-ignoring grandchild survives (AC-STE-686.9).
//
// Each mutant must turn its AC's behavioural test RED — the AC.4-.6 tests in
// `m_292387-ste-686-product-bounds.test.ts`, the AC.9 test in
// `m_292387-ste-686-gate-bound.test.ts`; each has a CONTROL, the same test
// against an UNPATCHED copy, which is GREEN.
//
// The 40-minute default (AC.9) is graded by a value pin in the gate-bound file,
// and the front door's killed-on-the-bound line (an AC.9 naming step) reddens
// that file's front-door test, which asserts the line itself.
//
// The harness bounds (AC.1 / AC.2) and the docs recipe (AC.7) are graded by
// source pins in `m_292387-ste-686-bounded-waits.test.ts`, which redden on the
// removal directly; the failing-test naming step (AC.8) reddens the two AC.8
// behavioural tests, which assert the identity line itself.
//
// NOTHING IN THE REPOSITORY IS EDITED. The target modules and their transitive
// local imports are copied into a throwaway tree under the OS temp dir (plugin
// layout preserved, `node_modules` symlinked for ts-morph), patched there, and
// the target test file is run as a subprocess with `STE686_SRC_ROOT` pointing
// at the copy. Every mutation is asserted to have APPLIED before its test runs.

import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

import { functionBody } from "./_m292387_source";
import { runNestedBunTest } from "./_nested_bun_test";

const PLUGIN_ROOT = resolve(import.meta.dir, "..");
const SHARED_SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");
const TARGET_TEST = join(PLUGIN_ROOT, "tests", "m_292387-ste-686-product-bounds.test.ts");
const GATE_BOUND_TEST = join(PLUGIN_ROOT, "tests", "m_292387-ste-686-gate-bound.test.ts");
const ENTRY_MODULES = [
  "spawn_receipt.ts",
  "signature_extractor.ts",
  "falsifiability_harness.ts",
  "gate_identity_run.ts",
  "gate_capture.ts",
].map((f) =>
  join(SHARED_SRC, f),
);

function localClosure(entries: readonly string[]): string[] {
  const seen = new Set<string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const m of readFileSync(file, "utf-8").matchAll(/(?:from\s+|import\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g)) {
      let target = resolve(dirname(file), m[1] as string);
      if (!target.endsWith(".ts")) target += ".ts";
      if (existsSync(target)) queue.push(target);
    }
  }
  return [...seen].sort();
}

const sha = (p: string): string => createHash("sha256").update(readFileSync(p)).digest("hex");
const CLOSURE = localClosure(ENTRY_MODULES);
const SHIPPED_HASHES = new Map(CLOSURE.map((f) => [f, sha(f)]));

/** The nearest `node_modules` at or above the plugin root (the repo installs it at the root). */
function nearestNodeModules(from: string): string {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules");
    if (existsSync(join(candidate, "ts-morph"))) return candidate;
    if (dirname(dir) === dir) throw new Error(`no node_modules with ts-morph at or above ${from}`);
  }
}
const NODE_MODULES = nearestNodeModules(PLUGIN_ROOT);

const TEMP_DIRS: string[] = [];
afterAll(() => {
  for (const d of TEMP_DIRS.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A fresh copy of the closure; returns the copy's `adapters/_shared/src`. */
function copyTree(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `m292387-686-mut-${label}-`));
  TEMP_DIRS.push(root);
  for (const file of CLOSURE) {
    const dest = join(root, relative(PLUGIN_ROOT, file));
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, readFileSync(file));
  }
  symlinkSync(NODE_MODULES, join(root, "node_modules"));
  return join(root, "adapters", "_shared", "src");
}

/**
 * Patch `file` in the copy: inside `region(src)`, replace the first `pattern`
 * match (every match for a `g` pattern) with `replacement`.
 */
function mutate(
  srcRoot: string,
  file: string,
  region: (src: string) => string | null,
  pattern: RegExp,
  replacement = "",
): void {
  const path = join(srcRoot, file);
  const src = readFileSync(path, "utf-8");
  const target = region(src);
  if (target === null) throw new Error(`mutation not applied: region not found in ${file}`);
  const patched = target.replace(pattern, replacement);
  if (patched === target) throw new Error(`mutation not applied: ${pattern} matched nothing in ${file}`);
  writeFileSync(path, src.replace(target, patched));
}

const frontDoor = (src: string): string | null => {
  const at = src.indexOf("if (import.meta.main)");
  return at === -1 ? null : src.slice(at);
};
const fn = (name: string) => (src: string) => functionBody(src, name);

const DROP_TIMEOUT = /\btimeout\s*:\s*[^,\n}]+,?/;
const DROP_SIGKILL = /\bkillSignal\s*:\s*["']SIGKILL["']\s*,?/;
const ANY_SIGKILL = /(["'])SIGKILL\1/g;
const wholeFile = (src: string): string => src;

function runTarget(
  srcRoot: string,
  testName: string,
  target: string = TARGET_TEST,
): { exitCode: number | null; output: string } {
  const proc = runNestedBunTest([target, "-t", testName], {
    cwd: PLUGIN_ROOT,
    env: { ...process.env, STE686_SRC_ROOT: srcRoot, NO_COLOR: "1" },
    timeoutMs: 60_000,
  });
  return { exitCode: proc.exitCode, output: `${proc.stdout}\n${proc.stderr}` };
}

interface Mutant {
  readonly id: string;
  readonly file: string;
  readonly region: (src: string) => string | null;
  readonly pattern: RegExp;
  readonly testName: string;
  /** The test file holding `testName`; the product-bounds file when absent. */
  readonly target?: string;
  /** What each `pattern` match becomes; "" when absent. */
  readonly replacement?: string;
}

const MUTANTS: readonly Mutant[] = [
  {
    id: "spawn_receipt drops timeout",
    file: "spawn_receipt.ts",
    region: frontDoor,
    pattern: DROP_TIMEOUT,
    testName: "AC-STE-686.4: a check that outlives the bound is killed at the bound",
  },
  {
    id: "spawn_receipt drops killSignal SIGKILL",
    file: "spawn_receipt.ts",
    region: frontDoor,
    pattern: DROP_SIGKILL,
    testName: "AC-STE-686.4: a check that outlives the bound is killed at the bound",
  },
  {
    id: "runTypedoc drops timeout",
    file: "signature_extractor.ts",
    region: fn("runTypedoc"),
    pattern: DROP_TIMEOUT,
    testName: "AC-STE-686.5: a typedoc that outlives its bound fails",
  },
  {
    id: "runAssertion drops timeout",
    file: "falsifiability_harness.ts",
    region: fn("runAssertion"),
    pattern: DROP_TIMEOUT,
    testName: "AC-STE-686.6: the assertion is stopped at its bound",
  },
  {
    id: "gate_identity_run drops the SIGKILL escalation",
    file: "gate_identity_run.ts",
    region: wholeFile,
    pattern: ANY_SIGKILL,
    replacement: '"SIGTERM"',
    testName: "AC-STE-686.9: a run that ignores SIGTERM is SIGKILLed after the grace period",
    target: GATE_BOUND_TEST,
  },
  {
    // The `/bin/sh -c` arm (the bun stack): the supervisor signals only the
    // direct child pid instead of its process group, so the TERM-ignoring
    // grandchild the stub `bun` started outlives the "killed" run.
    id: "gate_identity_run signals the child pid, not its process group",
    file: "gate_identity_run.ts",
    region: fn("signalGroup"),
    pattern: /process\.kill\(\s*-pid\b/,
    replacement: "process.kill(pid",
    testName: "AC-STE-686.9: a TERM-ignoring bun-stack run is killed with its grandchild, naming the bound",
    target: GATE_BOUND_TEST,
  },
];

describe("AC-STE-686.10 — removing each new bound or the SIGKILL escalation reddens a test", () => {
  for (const m of MUTANTS) {
    test(`AC-STE-686.10: control — "${m.testName}" is GREEN on an unpatched copy`, () => {
      const run = runTarget(copyTree("control"), m.testName, m.target);
      if (run.exitCode !== 0) throw new Error(`control is not green\n${run.output}`);
      expect(run.output).toMatch(/\b1 pass\b/);
    }, 90_000);

    test(`AC-STE-686.10: mutant — ${m.id} reddens "${m.testName}"`, () => {
      const root = copyTree("mutant");
      mutate(root, m.file, m.region, m.pattern, m.replacement);
      const run = runTarget(root, m.testName, m.target);
      expect(run.exitCode).not.toBe(0);
      expect(run.output).toMatch(/\b1 fail\b/);
    }, 90_000);
  }

  test("AC-STE-686.10: the shipped sources are untouched by the battery", () => {
    for (const [file, hash] of SHIPPED_HASHES) expect({ file, hash: sha(file) }).toEqual({ file, hash });
  });
});

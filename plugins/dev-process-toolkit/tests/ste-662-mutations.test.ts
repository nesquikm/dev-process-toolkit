// STE-662 — AC-STE-662.10: the two new behaviours are mutation-verified.
//
//   MUTANT 1. `runCapture` skips its pre-flight call → the AC-STE-662.2 test
//             (`ste-662-capture-preflight.test.ts`) must go RED: the gate runs
//             and leaves its marker before the late check refuses.
//   MUTANT 2. The `gate_capture.ts` front door drops its totals line → the
//             AC-STE-662.6 tests (`ste-662-gate-capture-totals.test.ts`) must go
//             RED.
//
// NOTHING IN THE REPOSITORY IS EDITED. The shipped modules and their transitive
// local imports are COPIED into a throwaway tree under the OS temp dir, keeping
// their paths relative to the plugin root so `../../` imports still resolve.
// The copy is patched, and the target test file is run as a subprocess with
// `STE662_SRC_ROOT` pointing at the copy's `adapters/_shared/src`. Each
// mutation is asserted to have APPLIED (bytes changed, the targeted call gone)
// before its test runs — a patch whose anchor stopped matching would otherwise
// report "the test stayed green" about an unmutated copy. Each mutant has a
// CONTROL: the same test, run against an UNPATCHED copy, is green. The shipped
// sources are hashed before and after the battery and must be byte-identical.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";

const PLUGIN_ROOT = resolve(import.meta.dir, "..");
const SHARED_SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");
const ENTRY_MODULES = [join(SHARED_SRC, "capture_skip_baseline.ts"), join(SHARED_SRC, "gate_capture.ts")];

// ===========================================================================
// The copied tree.
// ===========================================================================

/** Every local module the entry modules reach, transitively. */
function localClosure(entries: readonly string[]): string[] {
  const seen = new Set<string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf-8");
    for (const match of source.matchAll(/(?:from\s+|import\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g)) {
      let target = resolve(dirname(file), match[1] as string);
      if (!target.endsWith(".ts")) target += ".ts";
      if (existsSync(target)) queue.push(target);
    }
  }
  return [...seen].sort();
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const TEMP_DIRS: string[] = [];

/** A fresh copy of the closure; returns the copy's `adapters/_shared/src`. */
function copyTree(label: string): string {
  const root = mkdtempSync(join(tmpdir(), `ste662-mutant-${label}-`));
  TEMP_DIRS.push(root);
  for (const file of localClosure(ENTRY_MODULES)) {
    const target = join(root, relative(PLUGIN_ROOT, file));
    mkdirSync(dirname(target), { recursive: true });
    cpSync(file, target);
  }
  const manifest = join(PLUGIN_ROOT, ".claude-plugin", "plugin.json");
  if (existsSync(manifest)) {
    mkdirSync(join(root, ".claude-plugin"), { recursive: true });
    cpSync(manifest, join(root, ".claude-plugin", "plugin.json"));
  }
  return join(root, "adapters", "_shared", "src");
}

let hashesBefore: Record<string, string> = {};

beforeAll(() => {
  hashesBefore = Object.fromEntries(localClosure(ENTRY_MODULES).map((file) => [file, sha256(file)]));
});

afterAll(() => {
  for (const dir of TEMP_DIRS.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface TestRun {
  readonly exitCode: number;
  readonly output: string;
}

function runTarget(srcRoot: string, testFile: string, filter: string): TestRun {
  const proc = Bun.spawnSync(
    [process.execPath, "test", "--timeout", "120000", join("tests", testFile), "-t", filter],
    {
      cwd: PLUGIN_ROOT,
      env: { ...process.env, STE662_SRC_ROOT: srcRoot },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 300_000,
    },
  );
  return { exitCode: proc.exitCode ?? -1, output: `${proc.stdout.toString()}\n${proc.stderr.toString()}` };
}

/** The test ran at least one case, and every case it ran passed. */
function isGreen(run: TestRun): boolean {
  // Bun prints `(pass)` rows only on a TTY; the summary counter is always there.
  return run.exitCode === 0 && /^\s*[1-9]\d* pass$/m.test(run.output) && /^\s*0 fail$/m.test(run.output);
}

/**
 * The NAMED AC's case ran and failed on an assertion. A mutant that broke the
 * copied tree instead — a module that no longer loads, a syntax error — also
 * exits non-zero, so a bare `(fail)` row cannot tell "the test caught the
 * mutation" from "the copy is broken". Both halves are required: the failing
 * row names `ac`, and no load-time error appears in the output.
 */
function isRed(run: TestRun, ac: string): boolean {
  const failedRow = new RegExp(`^\\(fail\\) ${ac.replace(/\./g, "\\.")}\\b`, "m");
  const loadError = /Cannot find module|SyntaxError|Unhandled error between tests|error: Could not resolve/;
  return run.exitCode !== 0 && failedRow.test(run.output) && !loadError.test(run.output);
}

// ===========================================================================
// Patches.
// ===========================================================================

/** Body of the top-level `function NAME(` declaration, as [start, end) offsets. */
function functionSpan(source: string, name: string): [number, number] | null {
  const re = new RegExp(`^(?:export\\s+)?function\\s+${name}\\s*\\(`, "m");
  const match = re.exec(source);
  if (match === null) return null;
  const end = source.indexOf("\n}\n", match.index);
  return [match.index, end === -1 ? source.length : end + 2];
}

/** The exported precondition function's name in a `skip_baseline.ts` source. */
function preconditionName(skipBaselineSource: string): string | null {
  const names: string[] = [];
  for (const match of skipBaselineSource.matchAll(/^export\s+function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) {
    const name = match[1] as string;
    const span = functionSpan(skipBaselineSource, name) as [number, number];
    if (/\boffendingPaths\s*\(\s*projectRoot/.test(skipBaselineSource.slice(span[0], span[1]))) names.push(name);
  }
  return names.length === 1 ? (names[0] as string) : null;
}

/** MUTANT 1: delete runCapture's pre-flight call. Throws when it cannot apply. */
function dropPreflight(srcRoot: string): void {
  const name = preconditionName(readFileSync(join(srcRoot, "skip_baseline.ts"), "utf-8"));
  if (name === null) throw new Error("mutant 1: no single EXPORTED precondition function in skip_baseline.ts");

  const path = join(srcRoot, "capture_skip_baseline.ts");
  const before = readFileSync(path, "utf-8");
  const span = functionSpan(before, "runCapture");
  if (span === null) throw new Error("mutant 1: runCapture not found");
  const body = before.slice(span[0], span[1]);
  const callLine = new RegExp(`^[ \\t]*(?:await\\s+)?${name}\\s*\\([^;\\n]*\\)\\s*;?[ \\t]*$`, "m");
  const match = callLine.exec(body);
  if (match === null) throw new Error(`mutant 1: no \`${name}(...)\` statement in runCapture`);
  const mutatedBody = body.replace(callLine, "  // STE-662 mutant: pre-flight call removed");
  const after = before.slice(0, span[0]) + mutatedBody + before.slice(span[1]);
  writeFileSync(path, after);

  // Applied: bytes changed, and runCapture no longer calls the function.
  const written = readFileSync(path, "utf-8");
  if (written === before) throw new Error("mutant 1: the patch changed nothing");
  const newSpan = functionSpan(written, "runCapture") as [number, number];
  if (new RegExp(`\\b${name}\\s*\\(`).test(written.slice(newSpan[0], newSpan[1]))) {
    throw new Error(`mutant 1: runCapture still calls \`${name}\` after the patch`);
  }
}

/** Every `console.log(` / `process.stdout.write(` call, with its exact source span. */
function printCalls(source: string): Array<{ start: number; end: number; text: string }> {
  const calls: Array<{ start: number; end: number; text: string }> = [];
  for (const match of source.matchAll(/\b(?:console\.log|process\.stdout\.write)\s*\(/g)) {
    const start = match.index ?? 0;
    let depth = 0;
    let end = start;
    for (let i = start + match[0].length - 1; i < source.length; i += 1) {
      const ch = source[i];
      if (ch === "(") depth += 1;
      else if (ch === ")") {
        depth -= 1;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (source[end] === ";") end += 1;
    calls.push({ start, end, text: source.slice(start, end) });
  }
  return calls;
}

function isTotalsPrint(text: string): boolean {
  return /\bpass\b[\s\S]*\bfail\b[\s\S]*\bskip\b/.test(text) || /totals/i.test(text);
}

/** MUTANT 2: delete the front door's totals print. Throws when it cannot apply. */
function dropTotalsLine(srcRoot: string): void {
  const path = join(srcRoot, "gate_capture.ts");
  const before = readFileSync(path, "utf-8");
  const targets = printCalls(before).filter((call) => isTotalsPrint(call.text));
  if (targets.length === 0) throw new Error("mutant 2: no totals print call in gate_capture.ts");

  let after = before;
  for (const call of [...targets].reverse()) {
    after = `${after.slice(0, call.start)}void 0 /* STE-662 mutant: totals line dropped */;${after.slice(call.end)}`;
  }
  writeFileSync(path, after);

  const written = readFileSync(path, "utf-8");
  if (written === before) throw new Error("mutant 2: the patch changed nothing");
  if (printCalls(written).some((call) => isTotalsPrint(call.text))) {
    throw new Error("mutant 2: a totals print survived the patch");
  }
}

// ===========================================================================
// The battery.
// ===========================================================================

describe("AC-STE-662.10 — the pre-flight and the totals line are mutation-verified", () => {
  test("CONTROL 1: AC-STE-662.2 is green against an unpatched copy", () => {
    const src = copyTree("control-preflight");
    const run = runTarget(src, "ste-662-capture-preflight.test.ts", "AC-STE-662.2");
    expect(isGreen(run), run.output).toBe(true);
  }, 300_000);

  test("MUTANT 1: runCapture without its pre-flight call turns AC-STE-662.2 red", () => {
    const src = copyTree("no-preflight");
    dropPreflight(src); // throws unless the mutation applied
    const run = runTarget(src, "ste-662-capture-preflight.test.ts", "AC-STE-662.2");
    expect(isRed(run, "AC-STE-662.2"), run.output).toBe(true);
  }, 300_000);

  test("CONTROL 2: AC-STE-662.6 is green against an unpatched copy", () => {
    const src = copyTree("control-totals");
    const run = runTarget(src, "ste-662-gate-capture-totals.test.ts", "AC-STE-662.6");
    expect(isGreen(run), run.output).toBe(true);
  }, 300_000);

  test("MUTANT 2: the front door without its totals line turns AC-STE-662.6 red", () => {
    const src = copyTree("no-totals");
    dropTotalsLine(src); // throws unless the mutation applied
    const run = runTarget(src, "ste-662-gate-capture-totals.test.ts", "AC-STE-662.6");
    expect(isRed(run, "AC-STE-662.6"), run.output).toBe(true);
  }, 300_000);

  test("the shipped sources are byte-identical after the battery", () => {
    const after = Object.fromEntries(localClosure(ENTRY_MODULES).map((file) => [file, sha256(file)]));
    expect(Object.keys(hashesBefore).length).toBeGreaterThan(0);
    expect(after).toEqual(hashesBefore);
  });
});

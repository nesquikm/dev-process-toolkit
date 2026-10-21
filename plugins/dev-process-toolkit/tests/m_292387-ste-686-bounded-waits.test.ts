// STE-686 — test waits pause without blocking, and the wedge capture recipe.
//
//   AC-STE-686.1  `_ste594_harness.ts` and the m_4df444-ste-595 fence-run suite
//                 carry no `Bun.sleepSync`; their waits are async and every
//                 caller awaits them.
//   AC-STE-686.2  every `ps` spawn in `_ste594_harness.ts` has a timeout of at
//                 most 2000 ms.
//   AC-STE-686.3  a wait whose condition never holds returns within its budget
//                 plus 500 ms, and a test that overruns its own timeout while
//                 waiting is stopped by bun AT that timeout — which a
//                 synchronous sleep loop cannot be, because bun cannot pre-empt
//                 synchronous code.
//   AC-STE-686.7  docs/implement-reference.md carries the wedge capture recipe.
//
// The AC.3 overrun case is run as a SUBPROCESS: a throwaway test file awaits a
// never-true harness wait under a 300 ms test timeout, and the wall clock of the
// whole `bun test` run is what is graded.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { enclosingCall, reachableNumbers, stripComments, timeoutExpressions } from "./_m292387_source";
import * as harness from "./_ste594_harness";
import { runNestedBunTest } from "./_nested_bun_test";

const PLUGIN_ROOT = resolve(import.meta.dir, "..");
const TESTS_DIR = join(PLUGIN_ROOT, "tests");
const HARNESS = join(TESTS_DIR, "_ste594_harness.ts");
const FENCE_595 = join(TESTS_DIR, "m_4df444-ste-595-phase-a-fence-run.test.ts");
const IMPLEMENT_REF = join(PLUGIN_ROOT, "docs", "implement-reference.md");

const read = (p: string): string => readFileSync(p, "utf-8");

const TEMP_DIRS: string[] = [];
function tempDir(label: string): string {
  const d = mkdtempSync(join(tmpdir(), `m292387-686-${label}-`));
  TEMP_DIRS.push(d);
  return d;
}
afterAll(() => {
  for (const d of TEMP_DIRS.splice(0)) rmSync(d, { recursive: true, force: true });
});

/**
 * Every call of `name(` in `src` that is not its own declaration, with the code
 * text immediately before it on the same statement.
 */
function callSites(src: string, name: string): { at: number; before: string; line: number }[] {
  const code = stripComments(src);
  const out: { at: number; before: string; line: number }[] = [];
  const re = new RegExp(`(?<![\\w$.])${name}\\s*\\(`, "g");
  for (const m of code.matchAll(re)) {
    const at = m.index!;
    const lineStart = code.lastIndexOf("\n", at) + 1;
    const before = code.slice(lineStart, at);
    if (/\bfunction\s*$/.test(before)) continue; // the declaration itself
    out.push({ at, before, line: code.slice(0, at).split("\n").length });
  }
  return out;
}

const HARNESS_WAITS = ["waitForKind", "waitDead", "spawnLive", "reap"] as const;
const FENCE_595_WAITS = ["waitForCalls", "reap"] as const;

/** Every test-tree file that imports the STE-594 harness, plus the harness. */
function harnessConsumers(): string[] {
  return readdirSync(TESTS_DIR)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => join(TESTS_DIR, f))
    .filter((p) => p === HARNESS || /from\s+["']\.\/_ste594_harness["']/.test(read(p)));
}

// ===========================================================================
// AC-STE-686.1
// ===========================================================================

describe("AC-STE-686.1 — the waits pause with await Bun.sleep, never Bun.sleepSync", () => {
  test("AC-STE-686.1: _ste594_harness.ts contains no Bun.sleepSync", () => {
    expect(stripComments(read(HARNESS))).not.toContain("Bun.sleepSync");
  });

  test("AC-STE-686.1: the m_4df444-ste-595 fence-run suite contains no Bun.sleepSync", () => {
    expect(stripComments(read(FENCE_595))).not.toContain("Bun.sleepSync");
  });

  test("AC-STE-686.1: both files pause their waits with `await Bun.sleep(`", () => {
    for (const p of [HARNESS, FENCE_595]) {
      expect({ file: p, awaits: /await\s+Bun\.sleep\(/.test(stripComments(read(p))) }).toEqual({ file: p, awaits: true });
    }
  });

  test("AC-STE-686.1: waitForKind, waitDead and spawnLive return promises", async () => {
    const sb = harness.makeSandbox("record");
    try {
      const kind = harness.waitForKind(sb, "never-recorded-kind", 1, 0, 10) as unknown;
      expect(kind).toBeInstanceOf(Promise);
      await kind;
      const dead = harness.waitDead([process.pid], 10) as unknown;
      expect(dead).toBeInstanceOf(Promise);
      await dead;
      const live = harness.spawnLive(sb, 1) as unknown;
      expect(live).toBeInstanceOf(Promise);
      await live;
    } finally {
      await (harness.reap(sb) as unknown);
    }
  }, 15_000);

  test("AC-STE-686.1: every call of a harness wait, in the harness and every suite importing it, is awaited", () => {
    const unawaited: string[] = [];
    for (const file of harnessConsumers()) {
      const src = read(file);
      for (const name of HARNESS_WAITS) {
        for (const site of callSites(src, name)) {
          if (!/\bawait\s+$/.test(site.before)) unawaited.push(`${file.slice(PLUGIN_ROOT.length + 1)}:${site.line} ${name}`);
        }
      }
    }
    expect(unawaited).toEqual([]);
  });

  test("AC-STE-686.1: every call of the 595 suite's own waits is awaited", () => {
    const src = read(FENCE_595);
    const unawaited: string[] = [];
    let sites = 0;
    for (const name of FENCE_595_WAITS) {
      for (const site of callSites(src, name)) {
        sites++;
        if (!/\bawait\s+$/.test(site.before)) unawaited.push(`${site.line} ${name}`);
      }
    }
    // Control: the suite does call its waits, so an empty list is a real answer.
    expect(sites).toBeGreaterThan(0);
    expect(unawaited).toEqual([]);
  });
});

// ===========================================================================
// AC-STE-686.2
// ===========================================================================

describe("AC-STE-686.2 — every ps spawn in the harness is bounded", () => {
  test("AC-STE-686.2: each `ps` spawn passes a timeout of at most 2000 ms", () => {
    const src = stripComments(read(HARNESS));
    const sites = [...src.matchAll(/\[\s*"ps"\s*,/g)].map((m) => m.index!);
    // Control: the harness does spawn ps (spawnLive's poll and reap's scan).
    expect(sites.length).toBeGreaterThanOrEqual(2);
    const verdicts = sites.map((at) => {
      const call = enclosingCall(src, at);
      const exprs = timeoutExpressions(call);
      const values = exprs.flatMap((e) => reachableNumbers(e, src));
      return {
        call: call.slice(0, 80),
        bounded: exprs.length > 0 && values.length > 0 && values.every((v) => v > 0 && v <= 2000) === true,
      };
    });
    expect(verdicts.filter((v) => !v.bounded)).toEqual([]);
  });
});

// ===========================================================================
// AC-STE-686.3
// ===========================================================================

describe("AC-STE-686.3 — a never-true wait is bounded, and bun can stop it", () => {
  test("AC-STE-686.3: waitDead on a pid that never dies returns false within budget + 500 ms", async () => {
    const budget = 800;
    const t0 = performance.now();
    const result = await (harness.waitDead([process.pid], budget) as unknown as Promise<boolean>);
    const elapsed = performance.now() - t0;
    expect(result).toBe(false);
    expect(elapsed).toBeGreaterThanOrEqual(budget - 50);
    expect(elapsed).toBeLessThanOrEqual(budget + 500);
  }, 10_000);

  test("AC-STE-686.3: waitForKind on a kind never recorded returns within budget + 500 ms", async () => {
    const sb = harness.makeSandbox("record");
    try {
      const budget = 800;
      const t0 = performance.now();
      const calls = await (harness.waitForKind(sb, "never-recorded-kind", 1, 0, budget) as unknown as Promise<unknown[]>);
      const elapsed = performance.now() - t0;
      expect(calls).toEqual([]);
      expect(elapsed).toBeLessThanOrEqual(budget + 500);
    } finally {
      await (harness.reap(sb) as unknown);
    }
  }, 10_000);

  /** Run a throwaway test file whose single test awaits `waitExpr` under a 300 ms test timeout. */
  function runOverrun(label: string, waitExpr: string): { elapsedMs: number; output: string } {
    const dir = tempDir(label);
    const file = join(dir, `overrun-${label}.test.ts`);
    writeFileSync(
      file,
      [
        'import { afterAll, test } from "bun:test";',
        `import * as h from ${JSON.stringify(HARNESS)};`,
        'const sb = h.makeSandbox("record");',
        "afterAll(() => { try { require(\"node:fs\").rmSync(sb.root, { recursive: true, force: true }); } catch {} });",
        `test("overruns while waiting", async () => { await (${waitExpr}); }, 300);`,
        "",
      ].join("\n"),
    );
    const t0 = performance.now();
    const proc = runNestedBunTest([`./overrun-${label}.test.ts`], {
      cwd: dir,
      timeoutMs: 20_000,
      env: { ...process.env, NO_COLOR: "1" },
    });
    return {
      elapsedMs: performance.now() - t0,
      output: `${proc.stdout}\n${proc.stderr}`,
    };
  }

  test("AC-STE-686.3: a test overrunning its timeout inside waitDead is stopped by bun at that timeout", () => {
    // The wait's own budget is 6 s; the test's timeout is 300 ms. A synchronous
    // sleep loop cannot be pre-empted, so the run would last the full 6 s.
    const run = runOverrun("waitdead", "h.waitDead([process.pid], 6_000)");
    expect(run.output).toMatch(/timed out after 300\s*ms/);
    expect(run.elapsedMs).toBeLessThan(4_000);
  }, 25_000);

  test("AC-STE-686.3: a test overrunning its timeout inside waitForKind is stopped by bun at that timeout", () => {
    const run = runOverrun("waitforkind", 'h.waitForKind(sb, "never-recorded-kind", 1, 0, 6_000)');
    expect(run.output).toMatch(/timed out after 300\s*ms/);
    expect(run.elapsedMs).toBeLessThan(4_000);
  }, 25_000);
});

// ===========================================================================
// AC-STE-686.7
// ===========================================================================

describe("AC-STE-686.7 — implement-reference carries the wedge capture recipe", () => {
  const RECIPE = "ps -axo pid,ppid,pcpu,etime,command | grep bun";

  test("AC-STE-686.7: the recipe command is present verbatim", () => {
    expect(read(IMPLEMENT_REF)).toContain(RECIPE);
  });

  test("AC-STE-686.7: next to the command, it reads a spinning test apart from a nested pile-up", () => {
    const doc = read(IMPLEMENT_REF);
    const at = doc.indexOf(RECIPE);
    expect(at).toBeGreaterThanOrEqual(0);
    const near = doc.slice(Math.max(0, at - 1_500), at + 1_500);
    // While the gate is stalled — the recipe is for a live wedge.
    expect(near).toMatch(/stall/i);
    // A spinning test: one bun pid at high CPU.
    expect(near).toMatch(/spinning/i);
    expect(near).toMatch(/high CPU/i);
    // A nested pile-up: a parent chain of bun test processes.
    expect(near).toMatch(/pile-up/i);
    expect(near).toMatch(/parent chain/i);
  });
});

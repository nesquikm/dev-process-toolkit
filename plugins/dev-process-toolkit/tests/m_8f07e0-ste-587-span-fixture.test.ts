// M_8f07e0 STE-587 — a two-root fixture, and a written acceptance of the
// smoke-leg gap.
//
// WHAT IS ALREADY ON DISK, measured on this tree at authoring time
// (2026-09-10, on the M_8f07e0 branch after STE-583 and STE-584 landed):
//
//   * `tests/_span_fixture.ts` exists (created by STE-583 as its first
//     consumer). `planA({})` OMITS the `spans_repos:` key — the undeclared
//     state — rather than writing a bare key.
//   * `makeSpanFixture` is consumed by two suites (STE-583, STE-584); this
//     suite is the third.
//   * The milestone plan's `### Accepted gaps` section already carries every
//     AC.6 / AC.7 literal.
//
// So most of this suite is GREEN ON ARRIVAL by design: it grades a fixture
// and a plan section that were written ahead of it. Each such test is a
// regression pin, and the pure checkers behind the prose / count pins carry
// in-file NEGATIVE CONTROLS so a pin that could never fail shows up as a red
// control rather than as a silent pass.
//
// TEST STRATEGY.
//
//   * AC.2 is THE falsifiability clause. Every state runs on a FRESH fixture
//     against the SHIPPED `shipReadyMilestones` and `runActivePlanShipReadyProbe`
//     — never a re-implementation. Isolation is half the test: the busy answer
//     is asserted to DIFFER from the clear answer, the unlocatable notes to
//     DIFFER from the clear notes, and the undeclared state is built with a
//     BUSY sibling B on disk so it also differs from the declared-busy state
//     (the declaration, not the tree, is what makes B count).
//   * AC.3 drives a deliberate throw inside `try/finally` and checks
//     `existsSync` afterwards — teardown on the unhappy path is observed, not
//     assumed.
//   * AC.4 COMPUTES the consumer count (`grep -rln --include='*.test.ts'`
//     semantics) — never a literal list.
//   * AC.6 / AC.7 read the plan at `specs/plan/` OR `specs/plan/archive/`, so
//     the archive commit cannot red this suite; neither existing is a failure.
//     No bare number is pinned: the stated grep output is matched as `\d+`,
//     and the command is re-RUN to prove it is re-derivable, not compared.
//
// DELIBERATE OMISSIONS.
//
//   * AC.9 (full `bun test`, zero failures, skip count 15) is a gate command,
//     not something a test file can assert about the run it is part of.
//   * Clear and undeclared give the SAME observable answer on this API (both
//     `["M_GF_78"]`, both with only the ship-ready note), so no "five distinct
//     signatures" assertion is made — it would red a correct implementation.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  runActivePlanShipReadyProbe,
  shipReadyMilestones,
} from "../adapters/_shared/src/active_plan_ship_ready";
import { CANONICAL_CAPABILITY_KEYS } from "../adapters/_shared/src/closing_summary_capability_keys";
import { SMOKE_LEGS } from "../adapters/_shared/src/smoke_fixture_groups";
import { SpansReposError } from "../adapters/_shared/src/spans_repos";
import { type SpanFixture, makeSpanFixture } from "./_span_fixture";

// ===========================================================================
// Paths + shared constants.
// ===========================================================================

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const TESTS_DIR = join(PLUGIN_ROOT, "tests");
const GATE_CHECK_SKILL = join(PLUGIN_ROOT, "skills", "gate-check", "SKILL.md");
const PLAN_CANDIDATES = [
  join(REPO_ROOT, "specs", "plan", "M_8f07e0.md"),
  join(REPO_ROOT, "specs", "plan", "archive", "M_8f07e0.md"),
];

const read = (p: string): string => readFileSync(p, "utf-8");

const MILESTONE = "M_GF_78";
const A_NAME = "repo-a";
const B_NAME = "repo-b";
const A_FR = "STE-9001";
const B_FR = "STE-9002";

const SIBLING_UNLOCATABLE_PREFIX = "sibling-unlocatable milestones:";
const AWAITING_SIBLING_PREFIX = "awaiting-sibling milestones:";

/** Build a fixture, run `body`, and always tear both roots down. */
async function withFixture<T>(body: (fx: SpanFixture) => Promise<T>): Promise<T> {
  const fx = makeSpanFixture(MILESTONE);
  try {
    return await body(fx);
  } finally {
    fx.cleanup();
  }
}

/** Notes that talk about a declared sibling at all (awaiting or unlocatable). */
const spanNotes = (notes: readonly string[]): string[] =>
  notes.filter(
    (n) => n.startsWith(SIBLING_UNLOCATABLE_PREFIX) || n.startsWith(AWAITING_SIBLING_PREFIX),
  );

// ===========================================================================
// AC-STE-587.1 — two real, distinct roots with the spec skeleton.
// ===========================================================================

describe("AC-STE-587.1 — makeSpanFixture yields two real, distinct roots", () => {
  test("a and b are directories, differ after realpathSync, and each holds specs/plan/ + specs/frs/archive/", () => {
    const fx = makeSpanFixture(MILESTONE);
    try {
      for (const root of [fx.a, fx.b]) {
        expect(existsSync(root)).toBe(true);
        expect(statSync(root).isDirectory()).toBe(true);
        expect(statSync(join(root, "specs", "plan")).isDirectory()).toBe(true);
        expect(statSync(join(root, "specs", "frs", "archive")).isDirectory()).toBe(true);
      }
      // macOS mkdtemp hands back /var/… which resolves to /private/var/…:
      // compare the RESOLVED roots, never the raw strings.
      expect(realpathSync(fx.a)).not.toBe(realpathSync(fx.b));
    } finally {
      fx.cleanup();
    }
  });
});

// ===========================================================================
// AC-STE-587.2 — five states, five answers, on the SHIPPED predicate.
// ===========================================================================

interface StateAnswer {
  ready: string[];
  notes: string[];
}

async function answer(root: string): Promise<StateAnswer> {
  return {
    ready: await shipReadyMilestones(root),
    notes: (await runActivePlanShipReadyProbe(root)).notes,
  };
}

/** Sibling-busy: A archived its last FR, B still holds an active one. */
const siblingBusy = (): Promise<StateAnswer> =>
  withFixture(async (fx) => {
    fx.planA({ [A_NAME]: ".", [B_NAME]: fx.b });
    fx.archivedFr(fx.a, A_FR, MILESTONE);
    fx.activeFr(fx.b, B_FR, MILESTONE);
    return answer(fx.a);
  });

/** Sibling-clear: both roots archived their FRs. */
const siblingClear = (): Promise<StateAnswer> =>
  withFixture(async (fx) => {
    fx.planA({ [A_NAME]: ".", [B_NAME]: fx.b });
    fx.archivedFr(fx.a, A_FR, MILESTONE);
    fx.archivedFr(fx.b, B_FR, MILESTONE);
    return answer(fx.a);
  });

/** Sibling-unlocatable: the declared sibling path does not exist on disk. */
const siblingUnlocatable = (): Promise<StateAnswer> =>
  withFixture(async (fx) => {
    const missing = join(fx.b, "no-such-sibling");
    fx.planA({ [A_NAME]: ".", [B_NAME]: missing });
    fx.archivedFr(fx.a, A_FR, MILESTONE);
    // B DOES hold active work — but the declared path never reaches it.
    fx.activeFr(fx.b, B_FR, MILESTONE);
    return answer(fx.a);
  });

/**
 * Sibling-undeclared: no `spans_repos:` key at all, with B BUSY on disk — so
 * the only difference from sibling-busy is the declaration itself.
 */
const siblingUndeclared = (): Promise<StateAnswer> =>
  withFixture(async (fx) => {
    fx.planA({});
    fx.archivedFr(fx.a, A_FR, MILESTONE);
    fx.activeFr(fx.b, B_FR, MILESTONE);
    return answer(fx.a);
  });

/** Capture a rejection from `fn` (or null when it resolves). */
async function rejectionOf(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
    return null;
  } catch (e) {
    return e;
  }
}

describe("AC-STE-587.2 — five states give five answers on shipReadyMilestones(a)", () => {
  test("sibling-busy → [] (demoted to the awaiting-sibling row)", async () => {
    const busy = await siblingBusy();
    expect(busy.ready).toEqual([]);
    expect(busy.notes.some((n) => n.startsWith(AWAITING_SIBLING_PREFIX))).toBe(true);
    expect(busy.notes.some((n) => n.startsWith("ship-ready milestones:"))).toBe(false);
  });

  test("sibling-clear → [\"M_GF_78\"] with no sibling-unlocatable note", async () => {
    const clear = await siblingClear();
    expect(clear.ready).toEqual([MILESTONE]);
    expect(clear.notes.some((n) => n.startsWith(SIBLING_UNLOCATABLE_PREFIX))).toBe(false);
    expect(spanNotes(clear.notes)).toEqual([]);
  });

  test("sibling-unlocatable → [\"M_GF_78\"] plus a sibling-unlocatable note naming the sibling", async () => {
    const unloc = await siblingUnlocatable();
    expect(unloc.ready).toEqual([MILESTONE]);
    const row = unloc.notes.find((n) => n.startsWith(SIBLING_UNLOCATABLE_PREFIX));
    expect(row).toBeDefined();
    expect(row!).toContain(MILESTONE);
    expect(row!).toContain(B_NAME);
  });

  test("sibling-undeclared → [\"M_GF_78\"] with no span note, even with B busy on disk", async () => {
    const undeclared = await siblingUndeclared();
    expect(undeclared.ready).toEqual([MILESTONE]);
    expect(spanNotes(undeclared.notes)).toEqual([]);
  });

  test("malformed declaration → both shipReadyMilestones and the probe reject with SpansReposError", async () => {
    await withFixture(async (fx) => {
      // A flow list arrives from the parser as a STRING — a malformed spelling.
      fx.planA({}, { spans_repos: "[repo-a, repo-b]" });
      fx.archivedFr(fx.a, A_FR, MILESTONE);
      const fromPredicate = await rejectionOf(() => shipReadyMilestones(fx.a));
      const fromProbe = await rejectionOf(() => runActivePlanShipReadyProbe(fx.a));
      expect(fromPredicate).toBeInstanceOf(SpansReposError);
      expect(fromProbe).toBeInstanceOf(SpansReposError);
    });
  });

  test("the states are DIFFERENT answers, not five isolated passes", async () => {
    const [busy, clear, unloc, undeclared] = await Promise.all([
      siblingBusy(),
      siblingClear(),
      siblingUnlocatable(),
      siblingUndeclared(),
    ]);
    // AC-named differentials.
    expect(busy.ready).not.toEqual(clear.ready);
    expect(unloc.notes).not.toEqual(clear.notes);
    // The declaration is what makes B count: same busy tree, no key → ready.
    expect(undeclared.ready).not.toEqual(busy.ready);
    // The unlocatable row is the ONLY thing separating it from clear.
    expect(unloc.notes.filter((n) => !n.startsWith(SIBLING_UNLOCATABLE_PREFIX))).toEqual(
      clear.notes,
    );
  });
});

// ===========================================================================
// AC-STE-587.3 — teardown removes both roots, including on a throwing body.
// ===========================================================================

describe("AC-STE-587.3 — cleanup() removes both roots", () => {
  test("happy path: both roots exist before cleanup and are gone after it", () => {
    const fx = makeSpanFixture(MILESTONE);
    fx.planA({ [A_NAME]: ".", [B_NAME]: fx.b });
    fx.archivedFr(fx.a, A_FR, MILESTONE);
    fx.activeFr(fx.b, B_FR, MILESTONE);
    expect(existsSync(fx.a)).toBe(true);
    expect(existsSync(fx.b)).toBe(true);
    fx.cleanup();
    expect(existsSync(fx.a)).toBe(false);
    expect(existsSync(fx.b)).toBe(false);
    // Safe to call more than once.
    expect(() => fx.cleanup()).not.toThrow();
    expect(existsSync(fx.a)).toBe(false);
  });

  test("throwing body: the finally still removes both roots", () => {
    let roots: { a: string; b: string } | null = null;
    let existedBeforeThrow = false;
    const run = (): void => {
      const fx = makeSpanFixture(MILESTONE);
      roots = { a: fx.a, b: fx.b };
      try {
        fx.planA({ [A_NAME]: ".", [B_NAME]: fx.b });
        fx.activeFr(fx.b, B_FR, MILESTONE);
        existedBeforeThrow = existsSync(fx.a) && existsSync(fx.b);
        throw new Error("deliberate body failure before cleanup is reached");
      } finally {
        fx.cleanup();
      }
    };
    expect(run).toThrow("deliberate body failure before cleanup is reached");
    expect(existedBeforeThrow).toBe(true);
    expect(roots).not.toBeNull();
    expect(existsSync(roots!.a)).toBe(false);
    expect(existsSync(roots!.b)).toBe(false);
  });
});

// ===========================================================================
// AC-STE-587.4 — one home, computed consumer count.
// ===========================================================================

/** Recursive walk: files under `dir` ending `.test.ts` (grep --include='*.test.ts'). */
function testFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...testFilesUnder(full));
    else if (entry.isFile() && entry.name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

/** `grep -rln 'makeSpanFixture' --include='*.test.ts' <dir>` — the file list. */
function fixtureConsumers(dir: string): string[] {
  return testFilesUnder(dir)
    .filter((f) => read(f).includes("makeSpanFixture"))
    .sort();
}

/** Files under `dir` (any `.ts`) that DEFINE a `makeSpanFixture` function. */
function fixtureDefinitions(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (
        entry.isFile() &&
        entry.name.endsWith(".ts") &&
        /\bfunction\s+makeSpanFixture\s*\(/.test(read(full))
      )
        out.push(full);
    }
  };
  walk(dir);
  return out.sort();
}

describe("AC-STE-587.4 — one home: makeSpanFixture has at least three consumers", () => {
  test("grep -rln 'makeSpanFixture' --include='*.test.ts' tests/ returns >= 3 files", () => {
    const consumers = fixtureConsumers(TESTS_DIR);
    expect(consumers.length).toBeGreaterThanOrEqual(3);
  });

  test("the helper is defined in exactly one place: tests/_span_fixture.ts", () => {
    expect(fixtureDefinitions(TESTS_DIR)).toEqual([join(TESTS_DIR, "_span_fixture.ts")]);
  });

  test("negative control: the counter honours --include='*.test.ts' and recursion", () => {
    const dir = mkdtempSync(join(tmpdir(), "dpt-ste587-count-"));
    try {
      mkdirSync(join(dir, "nested"), { recursive: true });
      writeFileSync(join(dir, "one.test.ts"), "makeSpanFixture('M1');\n");
      writeFileSync(join(dir, "nested", "two.test.ts"), "makeSpanFixture('M2');\n");
      writeFileSync(join(dir, "_helper.ts"), "makeSpanFixture('M3');\n"); // not a suite
      writeFileSync(join(dir, "other.test.ts"), "nothing here\n");
      expect(fixtureConsumers(dir).length).toBe(2);
      expect(fixtureConsumers(dir).length).toBeLessThan(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ===========================================================================
// AC-STE-587.5 — the leg roster is unmoved.
// ===========================================================================

describe("AC-STE-587.5 — SMOKE_LEGS is exactly linear, jira, none", () => {
  test("SMOKE_LEGS deep-equals the three-leg roster", () => {
    expect([...SMOKE_LEGS]).toEqual(["linear", "jira", "none"]);
  });
});

// ===========================================================================
// AC-STE-587.6 / AC-STE-587.7 — the written acceptance, re-derivable + honest.
// ===========================================================================

/** The milestone plan, from the live path or the archive; null if neither. */
function readMilestonePlan(): { path: string; text: string } | null {
  for (const p of PLAN_CANDIDATES) {
    if (existsSync(p)) return { path: p, text: read(p) };
  }
  return null;
}

/**
 * The `### Accepted gaps` section: from its heading up to (not including) the
 * next `### ` or `## ` heading line. Null when the heading is absent.
 */
function acceptedGapsSection(planText: string): string | null {
  const lines = planText.split("\n");
  const start = lines.findIndex((l) => /^### Accepted gaps\s*$/.test(l));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^(###|##) /.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

/**
 * The line carrying the full `grep -rlE` command AND its stated output. The
 * command must search for `SMOKE_LEGS`, pipe through `wc -l`, and be followed
 * on the SAME line by an arrow and a count of files. The count is `\d+` — no
 * bare number is pinned.
 */
const GREP_LINE_RE =
  /(grep -rlE '[^']*SMOKE_LEGS[^']*'(?:\s+--include='[^']+')*\s+\S+\s*\|\s*wc -l)\s*(?:→|->)\s*\d+\s+files?\b/;

function grepCommandLine(section: string): { line: string; command: string } | null {
  for (const line of section.split("\n")) {
    const m = GREP_LINE_RE.exec(line);
    if (m) return { line, command: m[1]! };
  }
  return null;
}

/** Every AC.6 / AC.7 finding against a plan text; [] means the section holds. */
function acceptedGapsFindings(planText: string): string[] {
  const section = acceptedGapsSection(planText);
  if (section === null) return ["missing heading: ### Accepted gaps"];
  const findings: string[] = [];
  if (!section.includes("SMOKE_LEGS")) findings.push("missing literal: SMOKE_LEGS");
  if (!/\b20\d{2}-\d{2}-\d{2}\b/.test(section)) findings.push("missing date");
  if (!section.includes("byte-identically green"))
    findings.push("missing phrase: byte-identically green");
  if (grepCommandLine(section) === null)
    findings.push("missing grep -rlE command with its stated output on the same line");
  if (!section.includes("not a substitute")) findings.push("missing phrase: not a substitute");
  return findings;
}

describe("AC-STE-587.6 / AC-STE-587.7 — the plan's Accepted gaps section", () => {
  test("the milestone plan exists at specs/plan/ or specs/plan/archive/", () => {
    const plan = readMilestonePlan();
    expect(plan).not.toBeNull();
  });

  test("the section carries the heading, SMOKE_LEGS, a date, byte-identically green, the grep line, and not a substitute", () => {
    const plan = readMilestonePlan();
    expect(plan).not.toBeNull();
    expect(acceptedGapsFindings(plan!.text)).toEqual([]);
  });

  test("AC.6 re-derivable: the stated grep command runs from the repo root and prints a count", () => {
    const plan = readMilestonePlan();
    expect(plan).not.toBeNull();
    const section = acceptedGapsSection(plan!.text);
    expect(section).not.toBeNull();
    const found = grepCommandLine(section!);
    expect(found).not.toBeNull();
    const res = spawnSync("bash", ["-c", found!.command], { cwd: REPO_ROOT, encoding: "utf-8" });
    expect(res.status).toBe(0);
    const printed = res.stdout.trim();
    expect(printed).toMatch(/^\d+$/);
    expect(Number(printed)).toBeGreaterThan(0);
  });

  test("AC.7: `not a substitute` sits INSIDE the section, not merely somewhere in the plan", () => {
    const plan = readMilestonePlan();
    expect(plan).not.toBeNull();
    expect(acceptedGapsSection(plan!.text)!).toContain("not a substitute");
  });

  describe("negative controls — the checker reds on each sibling defect", () => {
    const livePlan = (): string => {
      const plan = readMilestonePlan();
      expect(plan).not.toBeNull();
      return plan!.text;
    };

    test("heading renamed → finding", () => {
      const mutated = livePlan().replace("### Accepted gaps", "### Accepted risks");
      expect(acceptedGapsFindings(mutated)).toEqual(["missing heading: ### Accepted gaps"]);
    });

    test("byte-identically green dropped → finding", () => {
      const mutated = livePlan().replaceAll("byte-identically green", "unchanged");
      expect(acceptedGapsFindings(mutated)).toContain("missing phrase: byte-identically green");
    });

    test("stated grep output moved off the command line → finding", () => {
      const mutated = livePlan().replace(/(\| wc -l)\s*(?:→|->)\s*\d+\s+files?/, "$1\n\nIt printed some files.");
      expect(acceptedGapsFindings(mutated)).toContain(
        "missing grep -rlE command with its stated output on the same line",
      );
    });

    test("date dropped → finding", () => {
      const text = livePlan();
      const section = acceptedGapsSection(text)!;
      const mutated = text.replace(section, section.replace(/\b20\d{2}-\d{2}-\d{2}\b/g, "recently"));
      expect(acceptedGapsFindings(mutated)).toContain("missing date");
    });

    test("`not a substitute` moved to a LATER section → finding (section boundary holds)", () => {
      const text = livePlan();
      const section = acceptedGapsSection(text)!;
      const stripped = section.replaceAll("not a substitute", "no replacement");
      const mutated =
        text.replace(section, stripped) + "\n\n## Later\n\nThe fixture is not a substitute.\n";
      expect(acceptedGapsFindings(mutated)).toContain("missing phrase: not a substitute");
    });
  });
});

// ===========================================================================
// AC-STE-587.8 — no new probe, leg or key.
// ===========================================================================

/** Probe numbers heading `N. **` lines, in file order. */
function probeNumbers(skillText: string): number[] {
  return [...skillText.matchAll(/^(\d+)\. \*\*/gm)].map((m) => Number(m[1]));
}

/** True when `nums` is exactly 1..n in order. */
const isContiguousFromOne = (nums: readonly number[]): boolean =>
  nums.every((n, i) => n === i + 1);

describe("AC-STE-587.8 — no new probe, leg or key", () => {
  test("gate-check SKILL.md numbers 85 probes, contiguous 1..85", () => {
    const nums = probeNumbers(read(GATE_CHECK_SKILL));
    expect(nums.length).toBe(85);
    expect(isContiguousFromOne(nums)).toBe(true);
  });

  test("CANONICAL_CAPABILITY_KEYS.length is 45", () => {
    expect(CANONICAL_CAPABILITY_KEYS.length).toBe(45);
  });

  test("SMOKE_LEGS.length is 3", () => {
    expect(SMOKE_LEGS.length).toBe(3);
  });

  test("negative control: a gap or a duplicate breaks contiguity", () => {
    expect(isContiguousFromOne(probeNumbers("1. **a**\n2. **b**\n4. **d**\n"))).toBe(false);
    expect(isContiguousFromOne(probeNumbers("1. **a**\n2. **b**\n2. **c**\n"))).toBe(false);
    expect(isContiguousFromOne(probeNumbers("1. **a**\n2. **b**\n3. **c**\n"))).toBe(true);
  });
});

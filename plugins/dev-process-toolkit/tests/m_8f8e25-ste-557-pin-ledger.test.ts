// STE-557 (M_8f8e25) — lowering the unreachable pin costs one edit, not three.
//
// THE DEFECT, MEASURED AT b0761df. Probe #81's remedy is to lower
// `ORDERED_UNREACHABLE_PIN`. Three surfaces stated that number and had to agree
// byte-for-byte:
//
//   1. `adapters/_shared/src/module_reachability.ts` — the constant itself.
//   2. `tests/m140-ste-543-external-link-verdicts.test.ts` — a SIBLING suite's
//      `expect(ORDERED_UNREACHABLE_PIN).toBe(129)`. True for exactly one
//      commit; every later lowering redded a file the lowering did not name.
//   3. `skills/gate-check/SKILL.md` — "one of the 129 records it pins", pinned
//      by `tests/m136-ste-531-order-fires.test.ts`.
//
// And a fourth thing, which is the reason this FR is a fix and not a chore:
// `tests/m141-ste-545-release-writer-door.test.ts` carries a leg NAMED "the pin
// only ever FELL" that compared two frozen literals in its own file (131 and
// 133) to each other. It never read the pin, so it could not fail on it.
// MEASURED: mutating the constant 129 -> 128 redded seven legs across five
// files and left that one green.
//
// THE FIX. The count becomes the head of `ORDERED_UNREACHABLE_PIN_LEDGER`, a
// newest-first record of every move the pin has made. The constant derives from
// the head, so there is one literal. `gradePinLedger` states the ceremony as
// code — a rationale is owed, a commit is owed, a raise is refused — and
// `runModuleReachabilityProbe` runs it, so a broken ledger is a gate error
// rather than a suite finding. Sibling suites assert against the ledger entry
// for THEIR OWN milestone's commit, which is a fact about history that no later
// lowering can invalidate.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

import {
  ORDERED_UNREACHABLE_PIN,
  ORDERED_UNREACHABLE_PIN_LEDGER,
  gradePinLedger,
  pinLedgerMove,
  pinValueBefore,
  runModuleReachabilityProbe,
  type UnreachablePinMove,
} from "../adapters/_shared/src/module_reachability";

const PLUGIN_ROOT = resolve(import.meta.dir, "..");
const REPO_ROOT = resolve(PLUGIN_ROOT, "..", "..");
const MODULE_REL = "adapters/_shared/src/module_reachability.ts";
const MODULE_ABS = join(PLUGIN_ROOT, MODULE_REL);
const M140_TEST_REL = "tests/m140-ste-543-external-link-verdicts.test.ts";
const M141_TEST_REL = "tests/m141-ste-545-release-writer-door.test.ts";
const M136_TEST_REL = "tests/m136-ste-531-order-fires.test.ts";

const read = (abs: string): string => readFileSync(abs, "utf-8");

/**
 * The file with its comments removed.
 *
 * The sweeps below hunt for an ASSERTION shape. A comment quoting the shape it
 * replaced — which is exactly how this repository records what a fix removed —
 * is not that assertion, and a sweep that could not tell them apart would
 * forbid writing down the defect.
 */
const code = (abs: string): string =>
  read(abs)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\/\/.*$/, ""))
    .join("\n");

/** The two shipped markdown trees probe #81 itself walks. */
const SCANNED_TREES = ["skills", "docs"] as const;

function shippedMarkdown(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const abs = join(dir, entry);
      if (statSync(abs).isDirectory()) walk(abs);
      else if (entry.endsWith(".md")) out.push(abs);
    }
  };
  for (const tree of SCANNED_TREES) walk(join(PLUGIN_ROOT, tree));
  return out.sort();
}

/**
 * EVERY test source in the plugin, for the tree-wide sweeps below.
 *
 * NOT just `tests/*.ts`. This repository keeps 71 suites COLOCATED beside the
 * modules they grade (`adapters/**\/*.test.ts`), and one of them —
 * `adapters/_shared/src/check_external_link.test.ts` — already names the pin.
 * A sweep whose failure message says "no test file anywhere" while reading one
 * non-recursive directory is the wrong-subject shape this FR exists to retire,
 * so the walk is recursive and covers both homes.
 */
function testSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === "fixtures") continue;
      const abs = join(dir, entry);
      if (statSync(abs).isDirectory()) walk(abs);
      else if (entry.endsWith(".ts")) out.push(abs);
    }
  };
  walk(join(PLUGIN_ROOT, "tests"));
  walk(join(PLUGIN_ROOT, "adapters"));
  return out.sort();
}

/** A well-formed fixture move — the base every fixture ledger is built from. */
const move = (value: number, commit: string, rationale = "a reason, recorded"): UnreachablePinMove => ({
  value,
  commit,
  rationale,
});

// ===========================================================================
// The overlay: a materialised copy of this repository in which ONE file is
// mutated, so a claim about which test reds can be measured rather than
// argued. Copying is ~0.5s and running one test file in it is ~1s; the
// alternative — mutating the shipped module in place while `bun test` is
// walking 541 files — would corrupt every file loaded after the mutation.
// ===========================================================================

interface OverlayRun {
  readonly code: number;
  readonly output: string;
}

/**
 * What the overlay needs at the repository root. `package.json` and `bun.lock`
 * are load-bearing, not decoration: `tests/m141-…` detects the gate command
 * from them, and an overlay without them reds a leg the mutation never
 * touched — measured, which is why the control run below exists at all.
 */
const ROOT_ENTRIES = [
  "README.md",
  "CHANGELOG.md",
  "CLAUDE.md",
  "specs",
  ".claude-plugin",
  "package.json",
  "bun.lock",
  "bunfig.toml",
  "tsconfig.json",
] as const;

/**
 * `filter` is bun's `-t` test-name selector, and it is load-bearing when the
 * file under mutation is THIS ONE: two of its describes spawn overlays
 * themselves, so an unfiltered self-run would nest overlays without bound.
 * Selecting a single describe excludes them by construction — a recursion
 * guard that needs no carve-out and no silent skip.
 */
function runTestFileUnder(
  mutate: (source: string) => string,
  testRel: string,
  filter: string | null = null,
): OverlayRun {
  const root = mkdtempSync(join(tmpdir(), "ste557-overlay-"));
  const copy = Bun.spawnSync(
    [
      "bash",
      "-c",
      `set -e; mkdir -p ${JSON.stringify(root)}/plugins; ` +
        `cp -R ${JSON.stringify(join(REPO_ROOT, "plugins", "dev-process-toolkit"))} ` +
        `${JSON.stringify(root)}/plugins/; ` +
        ROOT_ENTRIES.map(
          (e) =>
            `if [ -e ${JSON.stringify(join(REPO_ROOT, e))} ]; then cp -R ` +
            `${JSON.stringify(join(REPO_ROOT, e))} ${JSON.stringify(root)}/; fi`,
        ).join("; "),
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (copy.exitCode !== 0) {
    throw new Error(
      `the overlay could not be materialised (exit ${copy.exitCode}): ` +
        `${copy.stderr.toString().trim()} — this is a failure, not a skip: the ` +
        "mutation claim cannot be verified without it",
    );
  }
  symlinkSync(join(REPO_ROOT, "node_modules"), join(root, "node_modules"));

  const overlayPlugin = join(root, "plugins", "dev-process-toolkit");
  const target = join(overlayPlugin, MODULE_REL);
  const before = read(target);
  const after = mutate(before);
  if (after === before) {
    throw new Error(
      "the mutation changed nothing — a mutation that never applied reads as a " +
        "pass, which is the failure mode this helper exists to retire",
    );
  }
  Bun.write(target, after);

  const proc = Bun.spawnSync(
    filter === null ? ["bun", "test", testRel] : ["bun", "test", testRel, "-t", filter],
    { cwd: overlayPlugin, stdout: "pipe", stderr: "pipe" },
  );
  return {
    code: proc.exitCode ?? -1,
    output: `${proc.stdout.toString()}\n${proc.stderr.toString()}`,
  };
}

/** Did the named test fail in this run? Matched on bun's own `(fail)` row. */
const legFailed = (run: OverlayRun, name: string): boolean =>
  run.output.split("\n").some((line) => line.startsWith("(fail)") && line.includes(name));

/** Prepend a RAISE to the shipped ledger, in the overlay's own source text. */
const raiseTheHead = (source: string): string => {
  const anchor = "export const ORDERED_UNREACHABLE_PIN_LEDGER: readonly UnreachablePinMove[] = [";
  if (!source.includes(anchor)) throw new Error("the ledger declaration moved — anchor not found");
  return source.replace(
    anchor,
    `${anchor}\n  {\n    value: 132,\n    commit: "0000mut",\n` +
      `    rationale: "a mutation, not a move",\n  },`,
  );
};

/**
 * Prepend a well-formed LOWERING. The ceremony PASSES this — it carries a
 * rationale and a commit and the count falls — so anything that reds under it
 * reds because the measured count no longer equals the pin, never because the
 * ledger was rejected. That separation is the point of running both directions.
 */
const lowerTheHead = (source: string): string => {
  const anchor = "export const ORDERED_UNREACHABLE_PIN_LEDGER: readonly UnreachablePinMove[] = [";
  if (!source.includes(anchor)) throw new Error("the ledger declaration moved — anchor not found");
  return source.replace(
    anchor,
    `${anchor}\n  {\n    value: 128,\n    commit: "0000low",\n` +
      `    rationale: "a mutation: a well-formed lowering nothing measured",\n  },`,
  );
};

const CEREMONY_DESCRIBE = "AC-STE-557.5";
const ONE_HOME_DESCRIBE = "AC-STE-557.1";

// ===========================================================================
// AC-STE-557.1 — the pin has exactly one home.
// ===========================================================================

describe("AC-STE-557.1 — the pin is derived from the ledger head, not written twice", () => {
  test("the exported constant IS the head entry's value", () => {
    expect(ORDERED_UNREACHABLE_PIN_LEDGER.length).toBeGreaterThan(0);
    expect(ORDERED_UNREACHABLE_PIN).toBe(ORDERED_UNREACHABLE_PIN_LEDGER[0]!.value);
  });

  test("the module assigns no numeric literal to the pin", () => {
    const assignment = /\bORDERED_UNREACHABLE_PIN\b[^=\n]*=\s*\d+/;
    expect(
      assignment.test(read(MODULE_ABS)),
      "the pin is assigned a bare literal again — that is the second home this FR removed",
    ).toBe(false);
  });

  test("the pin's value appears in the module exactly once, as the head entry", () => {
    const occurrences = read(MODULE_ABS).split(`value: ${ORDERED_UNREACHABLE_PIN},`).length - 1;
    expect(occurrences, "the head value is written more than once in its own module").toBe(1);
  });
});

// ===========================================================================
// AC-STE-557.2 — the ledger is the MEASURED history.
// ===========================================================================

describe("AC-STE-557.2 — the ledger records the moves git records", () => {
  /** Taken from `git log -L 479,479:<module>` at b0761df, newest first. */
  const MEASURED = [129, 130, 131, 133, 136, 137, 139, 142, 146] as const;

  test("nine moves, in the measured order", () => {
    expect(ORDERED_UNREACHABLE_PIN_LEDGER.map((m) => m.value)).toEqual([...MEASURED]);
  });

  test("every recorded commit resolves in this repository", () => {
    const unresolved: string[] = [];
    for (const m of ORDERED_UNREACHABLE_PIN_LEDGER) {
      const proc = Bun.spawnSync(["git", "-C", REPO_ROOT, "cat-file", "-e", `${m.commit}^{commit}`], {
        stdout: "pipe",
        stderr: "pipe",
      });
      if (proc.exitCode !== 0) unresolved.push(`${m.value} -> ${m.commit}`);
    }
    expect(unresolved, "an audit trail that cannot be resolved is decoration").toEqual([]);
  });

  test("every move carries a non-blank rationale", () => {
    for (const m of ORDERED_UNREACHABLE_PIN_LEDGER) {
      expect(m.rationale.trim().length, `the move to ${m.value} has no reason`).toBeGreaterThan(20);
    }
  });

  test("the shipped ledger grades clean", () => {
    const verdict = gradePinLedger(ORDERED_UNREACHABLE_PIN_LEDGER);
    expect(verdict.refusals.join("\n")).toBe("");
    expect(verdict.ok).toBe(true);
  });

  test("`pinValueBefore` returns null for the origin and the predecessor otherwise", () => {
    const oldest = ORDERED_UNREACHABLE_PIN_LEDGER[ORDERED_UNREACHABLE_PIN_LEDGER.length - 1]!;
    expect(pinValueBefore(oldest.commit)).toBeNull();
    expect(pinValueBefore("5017488")).toBe(130);
    expect(pinLedgerMove("5017488").value).toBe(129);
  });

  test("a commit the ledger does not carry throws rather than answering", () => {
    expect(() => pinLedgerMove("nosuch1")).toThrow(/records no move made by nosuch1/);
    expect(() => pinValueBefore("nosuch1")).toThrow(/records no move made by nosuch1/);
  });
});

// ===========================================================================
// AC-STE-557.3 — a lowering owes a rationale. BOTH halves.
// ===========================================================================

describe("AC-STE-557.3 — the ceremony refuses a reasonless lowering and passes a reasoned one", () => {
  const reasonless: readonly UnreachablePinMove[] = [
    { value: 120, commit: "aaaaaaa", rationale: "   " },
    move(129, "5017488"),
  ];
  const reasoned: readonly UnreachablePinMove[] = [
    { value: 120, commit: "aaaaaaa", rationale: "a front door landed on the scanner" },
    move(129, "5017488"),
  ];

  test("a lowering with no rationale is REFUSED, and the refusal names the move", () => {
    const verdict = gradePinLedger(reasonless);
    expect(verdict.ok).toBe(false);
    expect(verdict.refusals).toHaveLength(1);
    expect(verdict.refusals[0]).toContain("the move to 120 (aaaaaaa) carries no rationale");
  });

  test("the SAME lowering with a rationale PASSES", () => {
    // Without this half the refusal is satisfied by a grader that refuses
    // everything, which would be a worse pin than the prose it replaced.
    expect(gradePinLedger(reasoned)).toEqual({ ok: true, refusals: [] });
  });

  test("a move naming no commit is refused too, and separately", () => {
    const verdict = gradePinLedger([
      { value: 120, commit: "", rationale: "a reason" },
      move(129, "5017488"),
    ]);
    expect(verdict.ok).toBe(false);
    expect(verdict.refusals).toHaveLength(1);
    expect(verdict.refusals[0]).toContain("names no commit");
  });

  test("an empty ledger is refused — a count nobody wrote down is not a pin", () => {
    const verdict = gradePinLedger([]);
    expect(verdict.ok).toBe(false);
    expect(verdict.refusals[0]).toContain("the pin ledger is empty");
  });
});

// ===========================================================================
// AC-STE-557.4 — a RAISE is refused. Its own leg, its own fixture.
// ===========================================================================

describe("AC-STE-557.4 — raising the pin stays forbidden", () => {
  const raised: readonly UnreachablePinMove[] = [
    move(131, "bbbbbbb", "an order nobody can run, admitted"),
    move(129, "5017488"),
  ];

  test("a raise is REFUSED and the reason is named", () => {
    const verdict = gradePinLedger(raised);
    expect(verdict.ok).toBe(false);
    expect(verdict.refusals).toHaveLength(1);
    expect(verdict.refusals[0]).toContain("the pin was RAISED from 129 to 131");
    expect(verdict.refusals[0]).toContain("never sanctioned");
  });

  test("the refusal is about the RAISE, not about a missing rationale", () => {
    // Isolation: this fixture's rationale is present, so a grader that only
    // knew about rationales would return ok here and this leg would be
    // certifying the wrong subject.
    expect(raised[0]!.rationale.trim().length).toBeGreaterThan(0);
    expect(gradePinLedger(raised).refusals[0]).not.toContain("carries no rationale");
  });

  test("a move that changes NOTHING is refused", () => {
    const verdict = gradePinLedger([move(129, "ccccccc", "a reason"), move(129, "5017488")]);
    expect(verdict.ok).toBe(false);
    expect(verdict.refusals[0]).toContain("moved nothing");
  });

  test("the sanctioned direction still passes with the same shape", () => {
    expect(gradePinLedger([move(128, "ddddddd", "a reason"), move(129, "5017488")]).ok).toBe(true);
  });
});

// ===========================================================================
// AC-STE-557.5 — the GATE executes the ceremony, not only this suite.
// ===========================================================================

describe("AC-STE-557.5 — probe #81 grades the ledger it is handed", () => {
  const raised: readonly UnreachablePinMove[] = [
    move(131, "bbbbbbb", "an order nobody can run, admitted"),
    ...ORDERED_UNREACHABLE_PIN_LEDGER,
  ];

  test("a raised ledger is an ERROR in the probe's own report", async () => {
    const report = await runModuleReachabilityProbe(REPO_ROOT, raised);
    const errors = report.violations.filter((v) => v.severity === "error");
    const ceremony = errors.filter((v) => v.reason.includes("RAISED"));
    expect(ceremony.length).toBe(1);
    expect(report.ok).toBe(false);

    // NFR-10 canonical shape, the same one probe #81's count violation uses.
    const v = ceremony[0]!;
    expect(v.note).toBe(
      `plugins/dev-process-toolkit/${MODULE_REL}:1 — ${v.reason}`,
    );
    expect(v.message).toContain("Remedy: a move of the pin is one prepended");
    expect(v.message).toContain("Context: file=plugins/dev-process-toolkit/");
    expect(v.line).toBe(1);
  }, 60_000);

  test("a rationale-less ledger is an ERROR naming the rationale", async () => {
    const report = await runModuleReachabilityProbe(REPO_ROOT, [
      { value: 128, commit: "eeeeeee", rationale: "" },
      ...ORDERED_UNREACHABLE_PIN_LEDGER,
    ]);
    expect(report.violations.some((v) => v.reason.includes("carries no rationale"))).toBe(true);
    expect(report.ok).toBe(false);
  }, 60_000);

  test("the SHIPPED ledger produces no ceremony violation, and the run is clean", async () => {
    const report = await runModuleReachabilityProbe(REPO_ROOT);
    expect(report.violations.filter((v) => v.severity === "error")).toEqual([]);
    expect(report.orderedUnreachable).toBe(ORDERED_UNREACHABLE_PIN);
    expect(report.ok).toBe(true);
  }, 60_000);

  test("a broken ledger is NOT vacuous on a tree with nothing to scan", async () => {
    // The ledger is a property of the shipped module, not of the scanned tree.
    // A consumer checkout with no plugin sources still ships the ledger.
    const empty = mkdtempSync(join(tmpdir(), "ste557-empty-"));
    const broken = await runModuleReachabilityProbe(empty, raised);
    expect(broken.records).toHaveLength(0);
    expect(broken.violations.some((v) => v.reason.includes("RAISED"))).toBe(true);
    expect(broken.ok).toBe(false);

    // ...and the vacuity the probe has always had survives for a GOOD ledger.
    const vacuous = await runModuleReachabilityProbe(empty);
    expect(vacuous.records).toHaveLength(0);
    expect(vacuous.violations).toEqual([]);
    expect(vacuous.ok).toBe(true);
  }, 60_000);
});

// ===========================================================================
// AC-STE-557.6 — the sibling hard-code is gone, tree-wide.
// ===========================================================================

describe("AC-STE-557.6 — no suite pins the live pin to a bare literal", () => {
  test("the M140 suite asserts against its own ledger entry instead", () => {
    // Assembled from parts so THIS file does not itself carry the shape the
    // tree-wide sweep below forbids — a carve-out for the sweep's own source
    // would be the first hole punched in it.
    const removed = ["expect(ORDERED_UNREACHABLE", "_PIN).toBe(129)"].join("");
    expect(code(join(PLUGIN_ROOT, M140_TEST_REL))).not.toContain(removed);
    const body = read(join(PLUGIN_ROOT, M140_TEST_REL));
    expect(body).toContain("pinLedgerMove(M140_PIN_COMMIT)");
    expect(body).toContain('const M140_PIN_COMMIT = "5017488";');
  });

  test("no test file anywhere asserts the live pin EQUALS a literal", () => {
    // BOTH argument forms. The one-argument shape is what M140 shipped; the
    // two-argument `expect(x, "message").toBe(n)` is this repository's
    // PREVAILING idiom (live at tests/fr-summary-altitude-front-door.test.ts
    // and tests/m136-ste-531-order-fires.test.ts), so a sweep that read only
    // the first would wave through a reintroduction written in house style.
    //
    // `.toBe` ONLY. `toBeLessThan(<literal>)` and `toBeLessThanOrEqual(
    // <literal>)` against a FROZEN historical value are the sanctioned idiom —
    // they are how a suite says "never raised" — and must not be forbidden.
    const equality = /expect\(\s*ORDERED_UNREACHABLE_PIN\s*(?:,[\s\S]{0,400}?)?\)\s*\.toBe\(\s*\d+\s*\)/;
    const offenders = testSources()
      .filter((abs) => equality.test(code(abs)))
      .map((abs) => relative(PLUGIN_ROOT, abs));
    expect(
      offenders,
      "a suite pins the live pin to a literal — every later lowering reds a file it does not name",
    ).toEqual([]);
  });

  test("the sweep is non-vacuous — suites DO read the live pin", () => {
    const readers = testSources().filter((abs) => read(abs).includes("ORDERED_UNREACHABLE_PIN"));
    expect(readers.length).toBeGreaterThanOrEqual(4);
    // The colocated home is genuinely walked, not merely allowed for.
    expect(
      testSources().some((abs) => abs.includes("adapters/_shared/src/")),
      "the sweep never reached the colocated suites",
    ).toBe(true);
  });
});

// ===========================================================================
// AC-STE-557.7 — no shipped markdown restates the count.
// ===========================================================================

describe("AC-STE-557.7 — shipped prose names the pin and never its value", () => {
  const NAMES_THE_PIN = /ORDERED_UNREACHABLE_PIN|records it pins|pinned count/;
  const carriesTheValue = (line: string): boolean =>
    new RegExp(String.raw`(?<!\d)${ORDERED_UNREACHABLE_PIN}(?!\d)`).test(line);

  const naming = (): Array<{ surface: string; number: number; line: string }> => {
    const hits: Array<{ surface: string; number: number; line: string }> = [];
    for (const abs of shippedMarkdown()) {
      read(abs)
        .split("\n")
        .forEach((line, i) => {
          if (NAMES_THE_PIN.test(line)) {
            hits.push({ surface: relative(PLUGIN_ROOT, abs), number: i + 1, line });
          }
        });
    }
    return hits;
  };

  test("at least one shipped surface names the pin — the sweep is non-vacuous", () => {
    expect(naming().length).toBeGreaterThan(0);
  });

  test("none of those lines carries the pin's value", () => {
    expect(
      naming()
        .filter((h) => carriesTheValue(h.line))
        .map((h) => `${h.surface}:${h.number}`),
    ).toEqual([]);
  });

  test("MUTATION — re-inserting the value into the disclosure is caught", () => {
    const hits = naming();
    const disclosure = hits.find((h) => h.line.includes("is itself one of the records it pins"));
    expect(disclosure, "the disclosure sentence was deleted rather than reworded").toBeDefined();
    const mutated = disclosure!.line.replace(
      "one of the records it pins",
      `one of the ${ORDERED_UNREACHABLE_PIN} records it pins`,
    );
    expect(mutated).not.toBe(disclosure!.line);
    expect(carriesTheValue(mutated), "the sweep would not catch the restatement").toBe(true);
  });

  test("the M136 leg that used to REQUIRE the number now forbids it", () => {
    const body = read(join(PLUGIN_ROOT, M136_TEST_REL));
    expect(body).toContain("no shipped surface RESTATES the pinned count");
    expect(body).not.toContain("every shipped surface stating the pinned count states the CURRENT one");
  });
});

// ===========================================================================
// AC-STE-557.8 / AC-STE-557.9 — the named test can now fail on the pin.
// ===========================================================================

const M141_LEG = "the pin only ever FELL, and by exactly the number of references named as the cause";

describe("AC-STE-557.8 — the leg named for the pin reads the pin", () => {
  test("its source reads the live pin and the live ledger, not two frozen literals", () => {
    const body = read(join(PLUGIN_ROOT, M141_TEST_REL));
    const start = body.indexOf(`test("${M141_LEG}"`);
    expect(start).toBeGreaterThan(0);
    const leg = body.slice(start, body.indexOf("\n  });", start));
    expect(leg).toContain("pinLedgerMove(M141_PIN_COMMIT)");
    expect(leg).toContain("pinValueBefore(M141_PIN_COMMIT)");
    expect(leg).toContain("ORDERED_UNREACHABLE_PIN,");
    expect(leg).toContain("gradePinLedger(ORDERED_UNREACHABLE_PIN_LEDGER)");
    // The shape it replaced: two frozen literals compared to each other.
    expect(leg).not.toContain("expect(\n      PIN_NOW,");
  });

  test("MUTATION — a raised ledger head REDS that leg; today it did not", () => {
    const run = runTestFileUnder(raiseTheHead, M141_TEST_REL);
    expect(run.code).not.toBe(0);
    expect(
      legFailed(run, M141_LEG),
      `the named leg stayed green under a raised pin:\n${run.output.slice(0, 4000)}`,
    ).toBe(true);
  }, 180_000);
});

describe("AC-STE-557.9 — falsifiability, both directions, with siblings observed", () => {
  const SELF_REL = "tests/m_8f8e25-ste-557-pin-ledger.test.ts";

  test("CONTROL — a harmless edit leaves the M141 leg green", () => {
    // Isolation is half the test. Without a green control, a mutation run that
    // reds because the overlay itself is broken reads as a kill.
    const run = runTestFileUnder(
      (src) => src.replace("// The pin\n", "// The pin (control edit)\n"),
      M141_TEST_REL,
    );
    expect(
      legFailed(run, M141_LEG),
      `the control overlay redded the leg — the kill above proves nothing:\n${run.output.slice(0, 4000)}`,
    ).toBe(false);
    expect(run.code).toBe(0);
  }, 180_000);

  test("UP — a raised head kills the ceremony legs", () => {
    const run = runTestFileUnder(raiseTheHead, SELF_REL, CEREMONY_DESCRIBE);
    expect(run.code, `a raised head left ${CEREMONY_DESCRIBE} green`).not.toBe(0);
    expect(run.output).toContain("RAISED");
  }, 180_000);

  test("UP — the SIBLING one-home legs survive the same mutation", () => {
    // The half the first audit of this FR found missing. A mutation that reds
    // every leg proves nothing about which leg guards what; AC.1's legs are
    // about WHERE the number lives, and a raised head does not move it.
    const run = runTestFileUnder(raiseTheHead, SELF_REL, ONE_HOME_DESCRIBE);
    expect(
      run.code,
      `the raise redded ${ONE_HOME_DESCRIBE} too — the kill above is not ` +
        `attributable to the ceremony:\n${run.output.slice(0, 4000)}`,
    ).toBe(0);
  }, 180_000);

  test("DOWN — a well-formed lowering nothing measured still reds the count", () => {
    // The other direction. This ledger passes the ceremony outright, so the
    // red can only come from measured != pin — which is what proves the count
    // check is live rather than carried by the ceremony grader.
    const run = runTestFileUnder(lowerTheHead, SELF_REL, CEREMONY_DESCRIBE);
    expect(run.code, "a lowering nothing measured left the count legs green").not.toBe(0);
    expect(
      run.output.includes("RAISED"),
      "the lowering was refused as a raise — the two directions are conflated",
    ).toBe(false);
  }, 180_000);
});

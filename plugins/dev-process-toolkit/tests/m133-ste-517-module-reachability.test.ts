// STE-517 (M133) — "The inventory of unrunnable orders is generated, never
// written down."
//
// A new /gate-check probe walks the two shipped markdown trees, emits one
// classified record per module reference (surface, line, module, class,
// reachable), and pins the count of references that are both ORDERED and
// UNREACHABLE so the next one reddens the run that introduces it.
//
// RED-state until the implementation lands at:
//   plugins/dev-process-toolkit/adapters/_shared/src/module_reachability.ts
//
// THREE DESIGN DECISIONS this file pins, recorded in specs/plan/M133.md as
// deliberate departures from the approved design:
//
//  1. Reachability is `hasEntryPoint(m) OR transitively imported by something
//     with one` — NOT the design's `hasEntryPoint AND >= 1 non-test consumer`.
//     The AND-rule condemns working command-line front doors, including
//     `upgrade_staleness` (probe #69's own entry point) and this milestone's
//     brand-new ones. AC-STE-517.5's positive boundary exists to pin that.
//  2. The ordered test is LINE-scoped, not file-scoped. File-scoped would call
//     every reference in any file containing one carrier phrase ordered,
//     collapsing the three-class distinction into one.
//  3. Both shipped trees — `skills/` AND `docs/`. Skills-only leaves an
//     evasion hole: move an order into `docs/` and it escapes the check.
//
// MEASURED DRIFT, recorded here rather than quietly dropped (see the test
// named `MEASURED DRIFT` below): AC-STE-517.5's SECOND boundary case names
// `resume_classifier.ts` as "carrying no entry point and having no non-test
// importer at all". That was true when the FR was written; commit 8f1094d
// (STE-513, this same milestone) made `deliver_decision.ts` — which DOES carry
// an entry point — import `classifyResume` / `resumeChain` / `stepLines` from
// it. Under AC-STE-517.4's transitive rule the resume classifier is therefore
// REACHABLE today. The negative boundary is asserted on a module measured to
// still satisfy the premise, and the drift is pinned as its own fact.

import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// Module not yet present — these imports drive the RED state.
import {
  buildModuleGraph,
  classifyReferenceLine,
  CLASSIFIER_FIXTURES,
  HARNESS_PHRASES,
  ORDER_PHRASES,
  ORDERED_UNREACHABLE_PIN,
  PROBE_ID,
  REFERENCE_CLASSES,
  runModuleReachabilityProbe,
  scanSurfaceForModuleReferences,
  verifyClassifierFixtures,
} from "../adapters/_shared/src/module_reachability";

const pluginRoot = join(import.meta.dir, "..");
const repoRoot = join(pluginRoot, "..", "..");
const probeModulePath = join(
  pluginRoot,
  "adapters",
  "_shared",
  "src",
  "module_reachability.ts",
);
const gateCheckSkillMd = join(pluginRoot, "skills", "gate-check", "SKILL.md");

/** Plugin-relative module keys the graph is addressed by. */
const M = (name: string) => `adapters/_shared/src/${name}.ts`;

/**
 * The nine modules the plan names as the measured casualties of the design's
 * AND-rule: each carries a command-line entry point and has NO non-test
 * importer, so the AND-rule calls all nine unreachable while every one of them
 * is a working front door. `upgrade_staleness` is probe #69's own.
 */
const ENTRY_POINT_NO_IMPORTER_NINE = [
  M("capability_row_assert"),
  M("claim_witness_assert"),
  M("classify_diff"),
  M("fork_tdd_result_assert"),
  M("harness_artifact_paths"),
  M("smoke_verdict"),
  M("socratic_first_turn_assert"),
  M("template_source_analyzer"),
  M("upgrade_staleness"),
] as const;

/**
 * A shipped module measured to carry no entry point and to have no non-test
 * importer at all — the premise AC-STE-517.5's negative boundary needs. It is
 * named on `/deliver`'s own surface, which is exactly the class the second
 * clause of the original AND-rule was written to keep exposed.
 */
const NO_ENTRY_POINT_ORPHAN = M("auto_approve_marker");

/** A shipped module that carries an entry point (this milestone's front door). */
const REACHABLE_EXAMPLE = M("deliver_decision");

const DELIVER_SURFACE = "plugins/dev-process-toolkit/skills/deliver/SKILL.md";

// ─────────────────────────────────────────────────────────────────────────────
// Fixture helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Build a throwaway project root containing exactly `files`, hand it to `fn`. */
async function withFixture<T>(
  files: Record<string, string>,
  fn: (root: string) => Promise<T>,
): Promise<T> {
  const root = mkdtempSync(join(tmpdir(), "ste517-"));
  try {
    for (const [rel, body] of Object.entries(files)) {
      const abs = join(root, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, body, "utf-8");
    }
    return await fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const src = (rel: string) => `plugins/dev-process-toolkit/adapters/_shared/src/${rel}`;
const skill = (rel: string) => `plugins/dev-process-toolkit/skills/${rel}`;
const doc = (rel: string) => `plugins/dev-process-toolkit/docs/${rel}`;

/** The graph over the real shipped tree, built once. */
const realGraph = buildModuleGraph(repoRoot);

// ─────────────────────────────────────────────────────────────────────────────
// AC-STE-517.1 — one classified record per reference, nothing hand-authored
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-STE-517.1 — the record is generated, field by field", () => {
  test("every record carries the five fields with the declared types", async () => {
    const report = await runModuleReachabilityProbe(repoRoot);
    expect(Array.isArray(report.records)).toBe(true);
    expect(report.records.length).toBeGreaterThan(0);

    for (const r of report.records) {
      expect(typeof r.surface).toBe("string");
      expect(r.surface.length).toBeGreaterThan(0);
      expect(Number.isInteger(r.line)).toBe(true);
      expect(r.line).toBeGreaterThan(0);
      expect(typeof r.module).toBe("string");
      expect(r.module.length).toBeGreaterThan(0);
      expect(REFERENCE_CLASSES).toContain(r.refClass);
      expect(typeof r.reachable).toBe("boolean");
    }
  });

  test("nothing is hand-authored: surface:line really names module", async () => {
    const report = await runModuleReachabilityProbe(repoRoot);
    // Sample the whole set — every record must be re-derivable from disk.
    for (const r of report.records) {
      const body = readFileSync(join(repoRoot, r.surface), "utf-8")
        .replace(/^﻿/, "")
        .replace(/\r\n/g, "\n");
      const lineText = body.split("\n")[r.line - 1];
      expect(typeof lineText).toBe("string");
      expect(lineText!.includes(r.module)).toBe(true);
    }
  });

  test("the probe declares its own id", () => {
    expect(typeof PROBE_ID).toBe("string");
    expect(PROBE_ID.length).toBeGreaterThan(0);
  });

  test("the gate-check SKILL.md registers the probe by module and id", () => {
    const md = readFileSync(gateCheckSkillMd, "utf-8");
    expect(md.includes("adapters/_shared/src/module_reachability.ts")).toBe(true);
    expect(md.includes(PROBE_ID)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-STE-517.2 — both trees, on the existing shared walk
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-STE-517.2 — both shipped trees, one walk", () => {
  test("records land in the skills tree AND the docs tree", async () => {
    const report = await runModuleReachabilityProbe(repoRoot);
    const trees = new Set(
      report.records.map((r) =>
        r.surface.includes("/skills/") ? "skills" : r.surface.includes("/docs/") ? "docs" : "other",
      ),
    );
    expect(trees.has("skills")).toBe(true);
    expect(trees.has("docs")).toBe(true);
  });

  test("the docs tree carries ordered-and-unreachable references of its own", async () => {
    const report = await runModuleReachabilityProbe(repoRoot);
    const docsOrderedUnreachable = report.records.filter(
      (r) => r.surface.includes("/docs/") && r.refClass === "ordered" && !r.reachable,
    );
    // Skills-only would see NONE of these — that is the evasion hole.
    expect(docsOrderedUnreachable.length).toBeGreaterThan(0);
  });

  test("the shared walk is reused, not re-derived", () => {
    const source = readFileSync(probeModulePath, "utf-8");
    expect(source.includes("collectMarkdownFiles")).toBe(true);
    expect(source.includes("CARRIER_SCANNED_TREES")).toBe(true);
    expect(source.includes("./carrier_phrase_probe")).toBe(true);
    // A second markdown walk is exactly what the reuse forbids.
    expect(source.includes("readdirSync")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-STE-517.3 — exactly three classes, and the ordered test is LINE-scoped
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-STE-517.3 — three classes, line-scoped", () => {
  test("exactly three classification values, and no record escapes them", async () => {
    expect([...REFERENCE_CLASSES].sort()).toEqual(["descriptive", "harness", "ordered"]);
    expect(REFERENCE_CLASSES.length).toBe(3);

    const report = await runModuleReachabilityProbe(repoRoot);
    for (const r of report.records) expect(REFERENCE_CLASSES).toContain(r.refClass);
  });

  test("the phrase lists are non-empty and exported for reuse", () => {
    expect(ORDER_PHRASES.length).toBeGreaterThan(0);
    expect(HARNESS_PHRASES.length).toBeGreaterThan(0);
  });

  test("an order phrase on the line makes it ordered", () => {
    const phrase = ORDER_PHRASES[0]!;
    expect(classifyReferenceLine(`${phrase} \`${src("foo.ts")}\``)).toBe("ordered");
  });

  test("a harness phrase on the line makes it harness", () => {
    const phrase = HARNESS_PHRASES[0]!;
    expect(classifyReferenceLine(`${phrase} \`${src("foo.ts")}\``)).toBe("harness");
  });

  test("a line carrying neither is descriptive", () => {
    expect(classifyReferenceLine("The taxonomy lives in `gate_class.ts`.")).toBe("descriptive");
  });

  test("a carrier phrase ELSEWHERE in the file does not make a reference ordered", async () => {
    const phrase = ORDER_PHRASES[0]!;
    const body = [
      `${phrase} \`${src("deliver_decision.ts")}\` before anything is spawned.`,
      "",
      "Filler prose that carries no order at all.",
      "",
      `The taxonomy is code, in \`${src("auto_approve_marker.ts")}\`.`,
      "",
    ].join("\n");

    await withFixture({ "surface.md": body }, async (root) => {
      const records = scanSurfaceForModuleReferences(
        join(root, "surface.md"),
        root,
        realGraph,
      );
      const byModule = new Map(records.map((r) => [r.module, r]));
      const ordered = byModule.get(src("deliver_decision.ts"));
      const other = byModule.get(src("auto_approve_marker.ts"));

      expect(ordered).toBeDefined();
      expect(other).toBeDefined();
      // Line 1 is ordered. Line 5 is NOT — file-scoped would say otherwise,
      // and that is the whole departure this test exists to pin.
      expect(ordered!.refClass).toBe("ordered");
      expect(other!.refClass).not.toBe("ordered");
      expect(ordered!.line).toBe(1);
      expect(other!.line).toBe(5);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-STE-517.4 — reachability is mechanical, and TRANSITIVE
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-STE-517.4 — entry point, or transitively reached by one", () => {
  test("transitivity holds over a synthetic tree, and orphans stay out", async () => {
    const files: Record<string, string> = {
      [src("front.ts")]: [
        'import { b } from "./mid";',
        "export const front = () => b();",
        "if (import.meta.main) console.log(front());",
        "",
      ].join("\n"),
      [src("mid.ts")]: [
        'import { c } from "./leaf";',
        "export const b = () => c();",
        "",
      ].join("\n"),
      [src("leaf.ts")]: ["export const c = () => 1;", ""].join("\n"),
      [src("orphan.ts")]: ["export const d = () => 2;", ""].join("\n"),
      // A test file that imports the orphan must NOT rescue it.
      [src("orphan.test.ts")]: [
        'import { d } from "./orphan";',
        "export const used = d;",
        "",
      ].join("\n"),
    };

    await withFixture(files, async (root) => {
      const g = buildModuleGraph(root);
      expect(g.reachable(M("front"))).toBe(true);
      expect(g.reachable(M("mid"))).toBe(true); // direct
      expect(g.reachable(M("leaf"))).toBe(true); // transitive — two hops
      expect(g.reachable(M("orphan"))).toBe(false);

      expect(g.hasEntryPoint(M("front"))).toBe(true);
      expect(g.hasEntryPoint(M("mid"))).toBe(false);
      expect(g.nonTestImporters(M("orphan"))).toEqual([]);
    });
  });

  test("the graph never drags vendored trees into scope", () => {
    for (const m of realGraph.modules) expect(m.includes("node_modules")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-STE-517.5 — both boundary cases, validated rather than asserted
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-STE-517.5 — the two boundary cases the rule was corrected for", () => {
  test("POSITIVE: the nine entry-point-no-importer modules are reachable", () => {
    for (const m of ENTRY_POINT_NO_IMPORTER_NINE) {
      // Premise, measured from the graph itself — not assumed.
      expect(realGraph.hasEntryPoint(m)).toBe(true);
      expect(realGraph.nonTestImporters(m)).toEqual([]);
      // Conclusion. The design's AND-rule returns false for every one of these.
      expect(realGraph.reachable(m)).toBe(true);
    }
    expect(ENTRY_POINT_NO_IMPORTER_NINE.length).toBe(9);
  });

  test("POSITIVE generalized: every entry point in the tree is reachable", () => {
    const entryPoints = realGraph.modules.filter((m) => realGraph.hasEntryPoint(m));
    expect(entryPoints.length).toBeGreaterThanOrEqual(ENTRY_POINT_NO_IMPORTER_NINE.length);
    for (const m of entryPoints) expect(realGraph.reachable(m)).toBe(true);
    // The nine are a subset of the measured set, not a stale parallel list.
    for (const m of ENTRY_POINT_NO_IMPORTER_NINE) expect(entryPoints).toContain(m);
  });

  test("NEGATIVE: no entry point and unreached by one ⇒ unreachable", () => {
    expect(realGraph.hasEntryPoint(NO_ENTRY_POINT_ORPHAN)).toBe(false);
    expect(realGraph.nonTestImporters(NO_ENTRY_POINT_ORPHAN)).toEqual([]);
    expect(realGraph.reachable(NO_ENTRY_POINT_ORPHAN)).toBe(false);
  });

  test("NEGATIVE non-vacuity: the unreachable class is not empty", () => {
    const unreachable = realGraph.modules.filter((m) => !realGraph.reachable(m));
    expect(unreachable.length).toBeGreaterThan(0);
    expect(unreachable).toContain(NO_ENTRY_POINT_ORPHAN);
    // ...and it is not everything, or the rule would be a constant.
    expect(unreachable.length).toBeLessThan(realGraph.modules.length);
  });

  test("MEASURED DRIFT: the FR's named negative case is now REACHABLE", () => {
    // AC-STE-517.5 says the resume classifier "carries no entry point and has
    // no non-test importer at all". Half of that is still true; the other half
    // stopped being true at commit 8f1094d (STE-513, this milestone), which
    // gave `deliver_decision.ts` — an entry point — a value import of it.
    // Under AC-STE-517.4's transitive rule it is therefore reachable. Pinned
    // as a fact so the contradiction is visible rather than quietly dropped.
    const rc = M("resume_classifier");
    expect(realGraph.hasEntryPoint(rc)).toBe(false);
    expect(realGraph.nonTestImporters(rc)).toContain(REACHABLE_EXAMPLE);
    expect(realGraph.hasEntryPoint(REACHABLE_EXAMPLE)).toBe(true);
    expect(realGraph.reachable(rc)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-STE-517.6 — the pin comes from a run, not from a document
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-STE-517.6 — the ordered-and-unreachable count is pinned", () => {
  test("the live run agrees with the pin", async () => {
    const report = await runModuleReachabilityProbe(repoRoot);
    const measured = report.records.filter((r) => r.refClass === "ordered" && !r.reachable).length;
    expect(measured).toBe(report.orderedUnreachable);
    expect(report.orderedUnreachable).toBe(ORDERED_UNREACHABLE_PIN);
  });

  test("the pin is non-vacuous: the class it counts actually exists", async () => {
    const report = await runModuleReachabilityProbe(repoRoot);
    expect(ORDERED_UNREACHABLE_PIN).toBeGreaterThan(0);
    expect(report.records.filter((r) => r.refClass === "ordered").length).toBeGreaterThan(0);
  });

  test("the pin is a written-down number, never a value computed at load", () => {
    const source = readFileSync(probeModulePath, "utf-8");
    // A pin assigned from a call is a mirror of the implementation and can
    // never disagree with it — which is the one thing a pin exists to do.
    //
    // WHAT CHANGED (STE-557): the pin is no longer `= <digits>` on its own
    // line. It is the HEAD of `ORDERED_UNREACHABLE_PIN_LEDGER`, because the
    // number used to be written in three places that had to agree
    // byte-for-byte and the sanctioned direction therefore cost three
    // coordinated edits. The invariant this leg exists for is untouched: the
    // head is still a hand-written literal, so the pin can still disagree with
    // the implementation, which is the whole point of a pin.
    expect(
      /export const ORDERED_UNREACHABLE_PIN\s*(?::\s*number\s*)?=\s*ORDERED_UNREACHABLE_PIN_LEDGER\[0\]!\.value;/.test(
        source,
      ),
      "the pin is no longer derived from the ledger head",
    ).toBe(true);
    expect(
      new RegExp(String.raw`value:\s*${ORDERED_UNREACHABLE_PIN},`).test(source),
      "the ledger head is not a written-down literal",
    ).toBe(true);
    // The thing that must NEVER return: a pin computed from the probe itself.
    expect(
      /ORDERED_UNREACHABLE_PIN\s*(?::\s*number\s*)?=\s*(?:await\s+)?(?:run|records|scan)/.test(
        source,
      ),
      "the pin is computed at load — it now mirrors the implementation it grades",
    ).toBe(false);
  });

  test("the pin is not carried from any prior document", async () => {
    // The design's own inventory figures — 136, 128, 193 — measured NOT to
    // reproduce when this probe was built, which is why the pin was taken from
    // a run instead. As of M137 the RUN reports 136: giving
    // `scan_fr_summary_altitude.ts` the `import.meta.main` front door its
    // sibling already carried made one catalogued order runnable, and the count
    // fell 137 → 136 onto one of those three numbers by coincidence.
    //
    // A value coincidence can therefore no longer discriminate provenance, so
    // this leg stops asking "is the pin one of the three?" — a question that now
    // has a false answer — and asks the one AC-STE-517.6 actually means: a
    // document figure is admissible ONLY when a run produces it. 136 is now
    // produced; 128 and 193 still are not, and a pin taken from either still
    // reds. Asserting equality with the live measurement is strictly stronger
    // than the three inequalities it replaces: every non-measured value fails,
    // not merely the three that were written down.
    const measured = (await runModuleReachabilityProbe(repoRoot)).orderedUnreachable;
    for (const figure of [136, 128, 193]) {
      if (figure === measured) continue;
      expect(
        ORDERED_UNREACHABLE_PIN,
        `${figure} is a prior document's figure and no run produces it`,
      ).not.toBe(figure);
    }
    expect(
      ORDERED_UNREACHABLE_PIN,
      `the pin must equal what the probe measures (${measured}), whatever any document said`,
    ).toBe(measured);
  });

  test("a seeded ordered-and-unreachable reference moves the count", async () => {
    const before = (await runModuleReachabilityProbe(repoRoot)).orderedUnreachable;
    const phrase = ORDER_PHRASES[0]!;
    await withFixture(
      {
        [skill("fixture-skill/SKILL.md")]: `${phrase} \`${src("auto_approve_marker.ts")}\`\n`,
      },
      async (root) => {
        const seeded = await runModuleReachabilityProbe(root);
        expect(seeded.orderedUnreachable).toBe(1);
      },
    );
    // The real tree is untouched by the fixture run.
    expect((await runModuleReachabilityProbe(repoRoot)).orderedUnreachable).toBe(before);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-STE-517.7 — the orchestrator's own count is ZERO
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-STE-517.7 — /deliver carries no unrunnable orders", () => {
  test("the orchestrator's ordered-and-unreachable count is zero", async () => {
    const report = await runModuleReachabilityProbe(repoRoot);
    const offenders = report.records.filter(
      (r) => r.surface === DELIVER_SURFACE && r.refClass === "ordered" && !r.reachable,
    );
    expect(offenders.map((r) => `${r.line}: ${r.module}`)).toEqual([]);
    expect(offenders.length).toBe(0);
  });

  test("non-vacuity: /deliver's surface is scanned, and DOES carry orders", async () => {
    const report = await runModuleReachabilityProbe(repoRoot);
    const onDeliver = report.records.filter((r) => r.surface === DELIVER_SURFACE);
    // A classifier tuned so that "ordered" never fires would pass the zero
    // assertion above for free. It must fire here.
    expect(onDeliver.length).toBeGreaterThan(0);
    expect(onDeliver.filter((r) => r.refClass === "ordered").length).toBeGreaterThan(0);
    expect(onDeliver.every((r) => r.refClass !== "ordered" || r.reachable)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-STE-517.8 / .9 — the classifier's own fixtures, mutation-verified
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-STE-517.8 — the classifier has its own fixture set", () => {
  test("fixtures cover all three classes and both reachability outcomes", () => {
    expect(CLASSIFIER_FIXTURES.length).toBeGreaterThanOrEqual(4);
    const classes = new Set(CLASSIFIER_FIXTURES.map((f) => f.expectedClass));
    expect([...classes].sort()).toEqual(["descriptive", "harness", "ordered"]);
    const reach = new Set(CLASSIFIER_FIXTURES.map((f) => f.expectedReachable));
    expect(reach.has(true)).toBe(true);
    expect(reach.has(false)).toBe(true);
    for (const f of CLASSIFIER_FIXTURES) {
      expect(typeof f.name).toBe("string");
      expect(f.line.includes(f.module)).toBe(true);
    }
  });

  test("every shipped fixture verifies clean", () => {
    expect(verifyClassifierFixtures(repoRoot)).toEqual([]);
  });
});

describe("AC-STE-517.9 — mutation: a misclassified fixture turns the check red", () => {
  test("flipping one fixture's expected CLASS is caught, one at a time", () => {
    const wrongClass = (c: string) => (c === "ordered" ? "descriptive" : "ordered");
    for (let i = 0; i < CLASSIFIER_FIXTURES.length; i++) {
      const mutated = CLASSIFIER_FIXTURES.map((f, j) =>
        j === i ? { ...f, expectedClass: wrongClass(f.expectedClass) } : { ...f },
      );
      const failures = verifyClassifierFixtures(repoRoot, mutated as typeof CLASSIFIER_FIXTURES);
      expect(failures.length).toBeGreaterThan(0);
      // The failure must NAME the mutated fixture, not merely count.
      expect(failures.join("\n").includes(CLASSIFIER_FIXTURES[i]!.name)).toBe(true);
    }
  });

  test("flipping one fixture's expected REACHABILITY is caught, one at a time", () => {
    for (let i = 0; i < CLASSIFIER_FIXTURES.length; i++) {
      const mutated = CLASSIFIER_FIXTURES.map((f, j) =>
        j === i ? { ...f, expectedReachable: !f.expectedReachable } : { ...f },
      );
      const failures = verifyClassifierFixtures(repoRoot, mutated as typeof CLASSIFIER_FIXTURES);
      expect(failures.length).toBeGreaterThan(0);
      expect(failures.join("\n").includes(CLASSIFIER_FIXTURES[i]!.name)).toBe(true);
    }
  });

  test("the mutation harness is not a constant: the unmutated set still passes", () => {
    expect(verifyClassifierFixtures(repoRoot, [...CLASSIFIER_FIXTURES])).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-STE-517.10 — non-vacuous in BOTH directions
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-STE-517.10 — nothing found vs nothing looked at", () => {
  test("a surface with no module references yields no records", async () => {
    const body = ["# A skill", "", "Prose that names no module at all.", ""].join("\n");
    await withFixture({ "empty.md": body }, async (root) => {
      expect(scanSurfaceForModuleReferences(join(root, "empty.md"), root, realGraph)).toEqual([]);
    });
  });

  test("a seeded surface yields EXACTLY its records", async () => {
    const phrase = ORDER_PHRASES[0]!;
    const body = [
      `${phrase} \`${src("deliver_decision.ts")}\` first.`,
      "",
      `Then the taxonomy in \`${src("auto_approve_marker.ts")}\`.`,
      "",
    ].join("\n");

    await withFixture({ "seeded.md": body }, async (root) => {
      const records = scanSurfaceForModuleReferences(join(root, "seeded.md"), root, realGraph);
      expect(records.length).toBe(2);
      expect(records.map((r) => [r.line, r.module, r.refClass, r.reachable])).toEqual([
        [1, src("deliver_decision.ts"), "ordered", true],
        [3, src("auto_approve_marker.ts"), "descriptive", false],
      ]);
    });
  });

  test("an empty plugin tree is vacuous, not a crash", async () => {
    await withFixture({ "README.md": "# nothing here\n" }, async (root) => {
      const report = await runModuleReachabilityProbe(root);
      expect(report.records).toEqual([]);
      expect(report.orderedUnreachable).toBe(0);
      expect(report.ok).toBe(true);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-STE-517.11 — a bad surface is a verdict, never a throw
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-STE-517.11 — the check never crashes the gate run", () => {
  test("an absent surface reads as no records", async () => {
    await withFixture({ "present.md": "# hi\n" }, async (root) => {
      expect(() =>
        scanSurfaceForModuleReferences(join(root, "absent.md"), root, realGraph),
      ).not.toThrow();
      expect(scanSurfaceForModuleReferences(join(root, "absent.md"), root, realGraph)).toEqual([]);
    });
  });

  test("a directory handed in where a file was expected reads as no records", async () => {
    await withFixture({ "dir/inner.md": "# hi\n" }, async (root) => {
      expect(scanSurfaceForModuleReferences(join(root, "dir"), root, realGraph)).toEqual([]);
    });
  });

  test("a malformed surface surfaces as a verdict", async () => {
    // Binary garbage, a stray BOM and CRLF line endings, all in one file.
    const malformed = `﻿# Broken\r\n \r\nSee \`${src("deliver_decision.ts")}\`\r\n`;
    await withFixture({ [skill("broken/SKILL.md")]: malformed }, async (root) => {
      let report: Awaited<ReturnType<typeof runModuleReachabilityProbe>> | undefined;
      await expect(
        (async () => {
          report = await runModuleReachabilityProbe(root);
        })(),
      ).resolves.toBeUndefined();
      expect(report).toBeDefined();
      expect(Array.isArray(report!.records)).toBe(true);
      // CRLF/BOM blindness, closed repo-wide on 2026-07-26, is not reintroduced:
      // the reference on the third line is still found, at line 3.
      const found = report!.records.filter((r) => r.module === src("deliver_decision.ts"));
      expect(found.length).toBe(1);
      expect(found[0]!.line).toBe(3);
    });
  });

  test("a project root that does not exist is a verdict, not a throw", async () => {
    const report = await runModuleReachabilityProbe(join(tmpdir(), "ste517-no-such-root-xyz"));
    expect(report.records).toEqual([]);
    expect(report.ok).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC-STE-517.12 — severity: only the pin fails the gate
// ─────────────────────────────────────────────────────────────────────────────

describe("AC-STE-517.12 — catalogued references never fail the gate", () => {
  test("the real tree passes, while still carrying ordered-and-unreachable refs", async () => {
    const report = await runModuleReachabilityProbe(repoRoot);
    expect(report.orderedUnreachable).toBeGreaterThan(0);
    expect(report.ok).toBe(true);
    expect(report.violations.filter((v) => v.severity === "error")).toEqual([]);
  });

  test("only a count that has moved off the pin produces an error violation", async () => {
    const phrase = ORDER_PHRASES[0]!;
    await withFixture(
      {
        [skill("fixture-skill/SKILL.md")]: [
          `${phrase} \`${src("auto_approve_marker.ts")}\``,
          `${phrase} \`${src("plan_lock.ts")}\``,
          "",
        ].join("\n"),
      },
      async (root) => {
        // Two ordered-and-unreachable references against a pin that is not 2.
        const seeded = await runModuleReachabilityProbe(root);
        expect(seeded.orderedUnreachable).toBe(2);
        if (ORDERED_UNREACHABLE_PIN !== 2) {
          expect(seeded.ok).toBe(false);
          const errors = seeded.violations.filter((v) => v.severity === "error");
          expect(errors.length).toBeGreaterThan(0);
          expect(errors.some((v) => String(v.message).includes(String(ORDERED_UNREACHABLE_PIN)))).toBe(
            true,
          );
        }
      },
    );
  });

  test("every violation carries a severity and an NFR-10 shaped note", async () => {
    const report = await runModuleReachabilityProbe(repoRoot);
    for (const v of report.violations) {
      expect(["error", "warning"]).toContain(v.severity);
      expect(typeof v.note).toBe("string");
      expect(typeof v.message).toBe("string");
    }
  });
});

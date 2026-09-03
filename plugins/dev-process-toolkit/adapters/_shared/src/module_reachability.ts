// module_reachability (STE-517, M133) — /gate-check probe #81.
//
// "The inventory of unrunnable orders is generated, never written down."
//
// Across the toolkit, shipped markdown names shared modules and tells the
// reader to run them — and most of those modules cannot be run. Counting them
// by hand produces a list that is stale the day it lands. So the list is
// PRODUCED: this module walks the two shipped markdown trees, emits one
// classified record per module reference (surface, line, module, class,
// reachable), and pins the count of references that are both ORDERED and
// UNREACHABLE so the next one reddens the run that introduces it.
//
// THREE DELIBERATE DEPARTURES from the approved design, all recorded in
// `specs/plan/M133.md` under "Deviations from the approved design":
//
//  1. REACHABILITY IS `entry point OR transitively imported by one`, not the
//     design's `entry point AND >= 1 non-test consumer`. Measured, the AND-rule
//     calls nine shipped modules unreachable that are working command-line
//     front doors — `upgrade_staleness` among them, which is probe #69's own
//     entry point — and it would condemn this milestone's new front doors on
//     the day they ship, so the fix would fail its own test. The second
//     clause's PURPOSE survives: a module carrying no entry point that nothing
//     with one reaches is still unreachable, which is the class that keeps
//     `runResume` and the auto-approve marker exposed.
//  2. THE ORDERED TEST IS LINE-SCOPED, not file-scoped. The shared carrier
//     engine's phrase test is file-scoped, and reused verbatim it would call
//     every reference in any file containing one carrier phrase "ordered",
//     collapsing the three-class distinction into one. The question here is
//     per-reference. A proximity window reaching into adjacent pre-existing
//     text is the wrong-subject shape recorded on this repo twice, so the
//     scope is the reference's OWN line and nothing else.
//  3. BOTH SHIPPED TREES — `skills/` AND `docs/`. Skills-only leaves an
//     evasion hole: move an order into `docs/` and it escapes the check, which
//     is documenting a claim away rather than fixing it.
//
// WHAT A GREEN ROW CERTIFIES — and what it does not (STE-531, M136).
//
// `reachable: true` answers exactly one question: the module CAN BE RUN —
// it is an entry point, or an entry point reaches it. It does not answer
// whether the order that names it will ever be given. Both halves of that
// gap were measured on this repo:
//
//  (a) At commit 9b420ec the probe classified BOTH skip-baseline orders as
//      `ordered` + `reachable: true` (pin 142, 343 records) while NEITHER
//      could fire in this project at all: one sits inside a paragraph
//      conditioned on a `branch_template:` key this repo does not set, the
//      other after a `git checkout -b` that an already-acceptable branch
//      never performs. The certificate was accurate; the inference drawn
//      from it — "so the order fires" — was not.
//  (b) The sharper direction, found by audit: an UNREACHABLE module is
//      hidden from this probe outright when every reference naming it
//      scores `descriptive`. `implement_report_evidence.ts` — the module
//      that renders EVERY `/implement` report's `## Verification evidence`
//      section — carries no entry point and no non-test importer, so it is
//      unreachable by the rule above; yet probe #81 never flags it, because
//      `classifyReferenceLine` scores both of its references
//      (`skills/implement/SKILL.md`, `docs/implement-reference.md`) as
//      `descriptive`: the phrase "render … through … from" carries none of
//      the ORDER_PHRASES. An unrunnable module a reader is expected to use
//      is invisible to the guard built for exactly that class.
//
// A recorded LIMIT, not a rule change. Departure 1 stands, and widening
// ORDER_PHRASES to swallow "from" is the re-tune departure 2 rejects: it
// would classify the whole tree as ordered and measure nothing.
//
// The WALK is reused from `./carrier_phrase_probe` (`collectMarkdownFiles`
// over `CARRIER_SCANNED_TREES`) rather than re-derived — a second markdown
// walk is exactly where the two would drift apart. What is NOT reused is that
// engine's file-scoped phrase test; see departure 2.
//
// Pure file reads only — no git, no network, no child processes.

import { Glob } from "bun";
import { existsSync, readFileSync } from "node:fs";
import { join, relative, dirname, resolve as resolvePath, sep } from "node:path";
import { CARRIER_SCANNED_TREES, collectMarkdownFiles } from "./carrier_phrase_probe";

export const PROBE_ID = "module_reachability";

export type Severity = "error" | "warning";

// ---------------------------------------------------------------------------
// Classification vocabulary
// ---------------------------------------------------------------------------

/**
 * Exactly three, and no record escapes them:
 *
 * - `ordered`    — the surface tells the reader to RUN that module (a command
 *                  line, or an imperative "call X from <module>").
 * - `descriptive`— the surface merely NAMES it.
 * - `harness`    — the module is executed by the TEST RUN rather than by a
 *                  skill.
 */
export const REFERENCE_CLASSES = ["ordered", "descriptive", "harness"] as const;
export type ReferenceClass = (typeof REFERENCE_CLASSES)[number];

/**
 * Carriers of an ORDER: the line instructs the reader to execute the module,
 * either as a command line or by invoking code out of it.
 *
 * Deliberately NOT here: "from", "via", "enforced by", "delegated to",
 * "returns" — those name a module without ordering anything, and a phrase list
 * that swallowed them would classify the whole tree as ordered, which measures
 * nothing.
 */
export const ORDER_PHRASES = [
  "bun run", // the canonical command-line invocation idiom in this repo
  "bunx",
  "Run it as", // "Run it as `bun run …`" — the same order, spelled in prose
  "run it as",
  "call `", // "call `runFooProbe(projectRoot)` from `<module>`"
  "Call `",
  "invoke `",
  "Invoke `",
  "run `",
  "Run `",
  "Read `", // "Read `readOrchestrationConfig().defaultEffort` (from `<module>`)"
] as const;

/**
 * Carriers of a HARNESS reference: the module is executed by the test run.
 *
 * Checked AFTER the order phrases, on purpose. A `/gate-check` probe entry
 * names its module in an imperative ("call `runX(projectRoot)` from …") and
 * ALSO cites its test file on the same line; that reference is an order the
 * skill carries out, not something only the suite executes. Order therefore
 * wins a line carrying both, and `harness` is what remains: a reference whose
 * only execution story is the suite.
 */
export const HARNESS_PHRASES = [
  "bun test",
  "the test run",
  "the test suite",
  "its own suite",
  "exercised by the suite",
] as const;

/**
 * Classify ONE line. LINE-scoped by construction — nothing outside the string
 * handed in can move the answer, which is departure 2 in force.
 */
export function classifyReferenceLine(line: string): ReferenceClass {
  for (const phrase of ORDER_PHRASES) {
    if (line.includes(phrase)) return "ordered";
  }
  for (const phrase of HARNESS_PHRASES) {
    if (line.includes(phrase)) return "harness";
  }
  return "descriptive";
}

/**
 * Strip a leading UTF-8 BOM and fold CRLF to LF, without changing the line
 * count.
 *
 * Both readers here normalize before they match: the graph builder over the
 * TypeScript sources, whose entry-point guard is line-anchored, and the surface
 * scanner over the markdown, which splits into numbered lines. They ran the
 * same expression twice; one function is what stops a later fix to one of them
 * from missing the other.
 */
function normalizeSource(text: string): string {
  return text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
}

// ---------------------------------------------------------------------------
// The module graph
// ---------------------------------------------------------------------------

/** The plugin-relative tree module keys are addressed by. */
const MODULE_TREE = "adapters";

/**
 * The shipped command-line entry-point guard, matched as CODE rather than as a
 * substring. Every front door in the tree opens with the same statement at
 * column zero; matching the bare token instead would call any module that
 * merely NAMES the guard in a comment — this one included — a front door, and
 * a reachability rule that rescues a module for talking about entry points
 * measures nothing.
 */
const ENTRY_POINT_GUARD = /^\s*if\s*\(\s*import\.meta\.main\s*\)/m;

export interface ModuleGraph {
  /** Every non-test module in the tree, plugin-relative, sorted. */
  readonly modules: string[];
  /** Does this module carry a command-line entry point? */
  hasEntryPoint(module: string): boolean;
  /** Non-test modules importing it, sorted. A test importer never rescues. */
  nonTestImporters(module: string): string[];
  /** Entry point, or transitively imported by something carrying one. */
  reachable(module: string): boolean;
}

/** A test file never rescues a module from unreachability. */
function isTestModule(key: string): boolean {
  return key.endsWith(".test.ts") || key.includes("/__tests__/") || key.includes("/tests/");
}

/** Normalize a filesystem path to the plugin-relative, posix-separated key. */
function toKey(pluginRoot: string, abs: string): string {
  return relative(pluginRoot, abs).split(sep).join("/");
}

/**
 * Every module specifier this source VALUE-imports. Type-only imports are
 * excluded on purpose: they vanish at runtime, so they cannot carry execution
 * from an entry point into the module they name.
 */
function valueImportSpecifiers(source: string): string[] {
  const out: string[] = [];
  const staticRe = /(?:^|\n)\s*(?:import|export)\b([^;]*?)\bfrom\s*["']([^"']+)["']/g;
  for (const m of source.matchAll(staticRe)) {
    const clause = m[1] ?? "";
    if (/^\s*type\b/.test(clause)) continue; // `import type … from …`
    out.push(m[2]!);
  }
  const dynamicRe = /\b(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const m of source.matchAll(dynamicRe)) out.push(m[1]!);
  return out;
}

/** Resolve a relative specifier against the importing module's key. */
function resolveSpecifier(
  fromKey: string,
  spec: string,
  known: ReadonlySet<string>,
): string | null {
  if (!spec.startsWith(".")) return null;
  const base = resolvePath("/" + dirname(fromKey), spec).slice(1);
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}/index.ts`,
    base.replace(/\.js$/, ".ts"),
  ]) {
    if (known.has(candidate)) return candidate;
  }
  return null;
}

/**
 * Build the import graph over `plugins/dev-process-toolkit/adapters/**\/*.ts`
 * under `projectRoot`, keyed by plugin-relative paths.
 *
 * Vacuous rather than a crash when that tree is absent — a consumer project
 * that never installed the toolkit's own sources has no graph to build, and
 * every lookup on the empty graph answers `false` / `[]`.
 */
export function buildModuleGraph(projectRoot: string): ModuleGraph {
  const pluginRoot = join(projectRoot, "plugins", "dev-process-toolkit");
  const treeRoot = join(pluginRoot, MODULE_TREE);

  const sources = new Map<string, string>();
  if (existsSync(treeRoot)) {
    let entries: string[] = [];
    try {
      entries = [...new Glob("**/*.ts").scanSync({ cwd: treeRoot, onlyFiles: true })];
    } catch {
      entries = [];
    }
    for (const rel of entries.sort()) {
      const posix = rel.split(sep).join("/");
      // Vendored trees never enter scope.
      if (posix.split("/").includes("node_modules")) continue;
      const abs = join(treeRoot, rel);
      let body: string;
      try {
        body = readFileSync(abs, "utf-8");
      } catch {
        continue;
      }
      sources.set(toKey(pluginRoot, abs), normalizeSource(body));
    }
  }

  const known = new Set(sources.keys());
  const imports = new Map<string, string[]>();
  const importedBy = new Map<string, string[]>();
  const entryPoints = new Set<string>();

  for (const [key, body] of sources) {
    if (ENTRY_POINT_GUARD.test(body) && !isTestModule(key)) entryPoints.add(key);
    const targets: string[] = [];
    for (const spec of valueImportSpecifiers(body)) {
      const target = resolveSpecifier(key, spec, known);
      if (target && target !== key) targets.push(target);
    }
    imports.set(key, [...new Set(targets)]);
  }

  for (const [key, targets] of imports) {
    if (isTestModule(key)) continue; // a test importer never rescues
    for (const target of targets) {
      const list = importedBy.get(target) ?? [];
      list.push(key);
      importedBy.set(target, list);
    }
  }

  // Reachability closure: breadth-first from every entry point, along
  // non-test value-import edges. An entry point is trivially reachable.
  const reached = new Set<string>();
  const queue = [...entryPoints];
  while (queue.length > 0) {
    const key = queue.shift()!;
    if (reached.has(key)) continue;
    reached.add(key);
    for (const target of imports.get(key) ?? []) {
      if (!reached.has(target)) queue.push(target);
    }
  }

  const modules = [...known].filter((k) => !isTestModule(k)).sort();

  return {
    modules,
    hasEntryPoint: (m) => entryPoints.has(m),
    nonTestImporters: (m) => [...new Set(importedBy.get(m) ?? [])].sort(),
    reachable: (m) => reached.has(m),
  };
}

// ---------------------------------------------------------------------------
// Reference extraction
// ---------------------------------------------------------------------------

/**
 * A module reference as written on a surface: any path ending in `.ts` that
 * runs through the `adapters/` tree. Both spellings the tree actually uses are
 * matched — the plugin-relative `adapters/_shared/src/x.ts` and the
 * repo-relative `plugins/dev-process-toolkit/adapters/_shared/src/x.ts` — and
 * the record carries the text VERBATIM, so every record is re-derivable from
 * the line it was read off.
 *
 * `${CLAUDE_PLUGIN_ROOT}/adapters/…` matches from `adapters` onward: `{` and
 * `}` are outside the path character class, which is what stops the shell
 * variable from being swallowed into the module name.
 */
const MODULE_REF_RE = new RegExp(
  `(?:[A-Za-z0-9_.-]+/)*${MODULE_TREE}/(?:[A-Za-z0-9_.-]+/)+[A-Za-z0-9_.-]+\\.ts`,
  "g",
);

/** The plugin-relative graph key for a reference as written. */
function referenceKey(written: string): string {
  const at = written.indexOf(`${MODULE_TREE}/`);
  return at === -1 ? written : written.slice(at);
}

export interface ModuleReferenceRecord {
  /** Repo-relative path of the surface the reference was read off. */
  surface: string;
  /** 1-based line number within that surface. */
  line: number;
  /** The module path exactly as written on that line. */
  module: string;
  refClass: ReferenceClass;
  reachable: boolean;
}

/**
 * Emit one record per (line, module) reference on one surface.
 *
 * Never throws: an absent file, a directory handed in where a file was
 * expected, or an unreadable surface all read as NO records — a verdict, not a
 * crashed gate run. CRLF/BOM blindness, closed repo-wide on 2026-07-26, is not
 * re-introduced: the surface is normalized before it is split into lines.
 */
export function scanSurfaceForModuleReferences(
  absPath: string,
  projectRoot: string,
  graph: ModuleGraph,
): ModuleReferenceRecord[] {
  let content: string;
  try {
    content = readFileSync(absPath, "utf-8");
  } catch {
    return [];
  }
  const surface = relative(projectRoot, absPath).split(sep).join("/");
  const lines = normalizeSource(content).split("\n");
  const records: ModuleReferenceRecord[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const text = lines[i]!;
    const refClass = classifyReferenceLine(text);
    for (const m of text.matchAll(MODULE_REF_RE)) {
      const written = m[0]!;
      const dedupe = `${i}|${written}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      records.push({
        surface,
        line: i + 1,
        module: written,
        refClass,
        reachable: graph.reachable(referenceKey(written)),
      });
    }
  }
  return records;
}

// ---------------------------------------------------------------------------
// The pin
// ---------------------------------------------------------------------------

/**
 * The count of references that are both ORDERED and UNREACHABLE across the two
 * shipped trees, as this check itself reported it at implementation time.
 *
 * A BARE LITERAL, never a value computed at load: a pin assigned from a call
 * is a mirror of the implementation and can never disagree with it, which is
 * the one thing a pin exists to do. Nothing here is carried from the design,
 * the FR or the plan — the design's own inventory figures measured NOT to
 * reproduce, which is the argument for generating this list rather than
 * writing it down.
 *
 * When this number moves, the run reds. Lowering it is the fix; raising it is
 * a decision to ship one more order nobody can carry out.
 *
 * Re-measured 139 → 137 under M137/STE-533: `stage_block_adoption.ts` gained
 * the `if (import.meta.main)` front door probe #82's registration requires, and
 * reachability is transitive — two references that were ordered-and-unreachable
 * are now ordered-and-reachable. A LOWERING, which is the sanctioned direction.
 *
 * Re-measured again 137 → 136 in the same milestone, for the same reason and by
 * the same remedy: `scan_fr_summary_altitude.ts` gained the `import.meta.main`
 * front door its sibling `scan_plan_narrative_altitude.ts` had carried since it
 * landed, so probe #67's one registration — which orders a reader to run BOTH
 * scanners — stopped naming a module nobody could run. A LOWERING again; the
 * pin has never been raised.
 *
 * Re-measured 133 → 131 under M141/STE-545: `release_config.ts` — which gained
 * its own `import.meta.main` front door in the same FR, and is therefore an
 * entry point — now imports `./docs_config` so the release writer can honour
 * `changelog_ci_owned`. Reachability is transitive, so the two ordered
 * references to `docs_config.ts` (skills/docs/SKILL.md and
 * skills/implement/SKILL.md) stopped naming a module nothing runnable reaches.
 * A LOWERING again; the pin has still never been raised.
 */
export const ORDERED_UNREACHABLE_PIN = 131;

// ---------------------------------------------------------------------------
// The probe
// ---------------------------------------------------------------------------

export interface ModuleReachabilityViolation {
  file: string;
  line: number;
  reason: string;
  note: string;
  message: string;
  severity: Severity;
}

export interface ModuleReachabilityReport {
  /** False only when the pinned count has MOVED. Catalogued refs never fail. */
  ok: boolean;
  records: ModuleReferenceRecord[];
  orderedUnreachable: number;
  violations: ModuleReachabilityViolation[];
}

const PROBE_MODULE_REL =
  "plugins/dev-process-toolkit/adapters/_shared/src/module_reachability.ts";

/**
 * The class the pin counts: an order nobody can carry out.
 *
 * One predicate because the report states this set twice — as the graded COUNT
 * and as the sample of offenders the error names. Two spellings of it could be
 * edited apart, and a sample that no longer described the counted set would
 * mislead exactly when the gate is red.
 */
function isOrderedUnreachable(record: ModuleReferenceRecord): boolean {
  return record.refClass === "ordered" && !record.reachable;
}

/**
 * Walk `plugins/dev-process-toolkit/{skills,docs}/**\/*.md` under
 * `projectRoot`, classify every module reference, and grade the
 * ordered-and-unreachable count against `ORDERED_UNREACHABLE_PIN`.
 *
 * SEVERITY IS NARROW BY DESIGN (AC-STE-517.12): the references this check
 * merely catalogues never fail the gate — they surface as ONE warning row
 * carrying the count. Only a count that has moved off the pin is an error.
 * A probe that redded every pre-existing order would be silenced within a day.
 *
 * Vacuous — zero records, zero violations, `ok: true` — when the walk finds no
 * module reference at all, which is the state of a project that never
 * installed the toolkit's own sources. Nothing found and nothing looked at are
 * therefore distinguishable by `records`, never conflated in `ok`.
 */
export async function runModuleReachabilityProbe(
  projectRoot: string,
): Promise<ModuleReachabilityReport> {
  const pluginRoot = join(projectRoot, "plugins", "dev-process-toolkit");
  const records: ModuleReferenceRecord[] = [];
  const violations: ModuleReachabilityViolation[] = [];

  if (existsSync(pluginRoot)) {
    const graph = buildModuleGraph(projectRoot);
    for (const tree of CARRIER_SCANNED_TREES) {
      const dir = join(pluginRoot, tree);
      if (!existsSync(dir)) continue;
      for (const file of collectMarkdownFiles(dir)) {
        records.push(...scanSurfaceForModuleReferences(file, projectRoot, graph));
      }
    }
  }

  const orderedUnreachable = records.filter(isOrderedUnreachable).length;

  // Nothing looked at ⇒ nothing to grade. Vacuous, not a verdict of zero.
  if (records.length === 0) {
    return { ok: true, records, orderedUnreachable, violations };
  }

  if (orderedUnreachable === ORDERED_UNREACHABLE_PIN) {
    if (orderedUnreachable > 0) {
      const reason =
        `${orderedUnreachable} module references are ordered and unreachable — ` +
        `catalogued, at the pinned count (${ORDERED_UNREACHABLE_PIN})`;
      const note = `${PROBE_MODULE_REL}:1 — ${reason}`;
      violations.push({
        file: join(projectRoot, PROBE_MODULE_REL),
        line: 1,
        reason,
        note,
        severity: "warning",
        message: [
          `${PROBE_ID}: ${note}`,
          "Remedy: none required — these are pre-existing orders this check " +
            "catalogues rather than fails. Give one of the named modules a " +
            "command-line entry point, or reword its order into a description, " +
            "and lower the pin by the same amount in the same commit.",
          `Context: file=${PROBE_MODULE_REL}, line=1, measured=${orderedUnreachable}, ` +
            `pin=${ORDERED_UNREACHABLE_PIN}, probe=${PROBE_ID}, severity=warning`,
        ].join("\n"),
      });
    }
    return { ok: true, records, orderedUnreachable, violations };
  }

  const direction = orderedUnreachable > ORDERED_UNREACHABLE_PIN ? "grown" : "fallen";
  const offenders = records
    .filter(isOrderedUnreachable)
    .slice(0, 10)
    .map((r) => `${r.surface}:${r.line} ${r.module}`)
    .join("; ");
  const reason =
    `ordered-and-unreachable count has ${direction}: measured ${orderedUnreachable}, ` +
    `pinned ${ORDERED_UNREACHABLE_PIN}`;
  const note = `${PROBE_MODULE_REL}:1 — ${reason}`;
  violations.push({
    file: join(projectRoot, PROBE_MODULE_REL),
    line: 1,
    reason,
    note,
    severity: "error",
    message: [
      `${PROBE_ID}: ${note}`,
      "Remedy: if the count GREW, a surface now orders a module nobody can " +
        "run — give that module an `import.meta.main` entry point, or reword " +
        "the order into a description. If the count FELL, that is the fix " +
        `landing: lower \`ORDERED_UNREACHABLE_PIN\` to ${orderedUnreachable} in ` +
        "the same commit. Never raise the pin to make a new order pass.",
      `Context: file=${PROBE_MODULE_REL}, line=1, measured=${orderedUnreachable}, ` +
        `pin=${ORDERED_UNREACHABLE_PIN}, probe=${PROBE_ID}, severity=error` +
        (offenders ? `, sample=${offenders}` : ""),
    ].join("\n"),
  });

  return { ok: false, records, orderedUnreachable, violations };
}

// ---------------------------------------------------------------------------
// The classifier's own fixtures
// ---------------------------------------------------------------------------

/**
 * The classifier is phrase-based, which makes it the part most likely to be
 * wrong while looking right. These fixtures test it in isolation from the
 * shipped trees, and they are mutation-verified in the suite: a fixture whose
 * expected class or expected reachability is deliberately flipped MUST turn
 * `verifyClassifierFixtures` red, naming that fixture. A classifier that
 * cannot fail on a wrong fixture is no classifier at all.
 */
export interface ClassifierFixture {
  name: string;
  /** The surface line, verbatim. Must contain `module`. */
  line: string;
  /** The module path as written on that line. */
  module: string;
  expectedClass: ReferenceClass;
  expectedReachable: boolean;
}

const ORDERED_REACHABLE = "adapters/_shared/src/deliver_decision.ts";
const NEVER_REACHED = "adapters/_shared/src/auto_approve_marker.ts";
const DESCRIBED_REACHABLE = "adapters/_shared/src/gate_class.ts";

export const CLASSIFIER_FIXTURES: readonly ClassifierFixture[] = [
  {
    name: "ordered-reachable-command-line",
    line: `bun run \${CLAUDE_PLUGIN_ROOT}/${ORDERED_REACHABLE} <argument> [projectRoot]`,
    module: ORDERED_REACHABLE,
    expectedClass: "ordered",
    expectedReachable: true,
  },
  {
    name: "ordered-unreachable-imperative-call",
    line: `On accept, call \`assertAutoApproveMarker(projectRoot)\` from \`${NEVER_REACHED}\`.`,
    module: NEVER_REACHED,
    expectedClass: "ordered",
    expectedReachable: false,
  },
  {
    name: "descriptive-reachable-names-only",
    line: `Gates are not interchangeable (the taxonomy is code, in \`${DESCRIBED_REACHABLE}\`).`,
    module: DESCRIBED_REACHABLE,
    expectedClass: "descriptive",
    expectedReachable: true,
  },
  {
    name: "descriptive-unreachable-enforced-by",
    line: `The auto-approve marker is enforced by \`${NEVER_REACHED}\`, never re-typed.`,
    module: NEVER_REACHED,
    expectedClass: "descriptive",
    expectedReachable: false,
  },
  {
    name: "harness-reachable-suite-executes-it",
    line: `\`bun test tests/m133-ste-513-deliver-decision.test.ts\` drives \`${ORDERED_REACHABLE}\`.`,
    module: ORDERED_REACHABLE,
    expectedClass: "harness",
    expectedReachable: true,
  },
  {
    name: "harness-unreachable-suite-executes-it",
    line: `\`bun test\` is the only thing that ever executes \`${NEVER_REACHED}\`.`,
    module: NEVER_REACHED,
    expectedClass: "harness",
    expectedReachable: false,
  },
];

/**
 * Grade every fixture through the SAME predicates the walk uses — the line
 * classifier and the reachability graph — and return one failure string per
 * disagreement, each NAMING the fixture. `[]` means every fixture verified.
 *
 * Naming rather than counting is what makes the mutation pass meaningful: a
 * harness that reported "3 failures" would pass a drop-one mutation without
 * ever showing which fixture moved.
 */
export function verifyClassifierFixtures(
  projectRoot: string,
  fixtures: readonly ClassifierFixture[] = CLASSIFIER_FIXTURES,
): string[] {
  const graph = buildModuleGraph(projectRoot);
  const failures: string[] = [];

  for (const fixture of fixtures) {
    if (!fixture.line.includes(fixture.module)) {
      failures.push(
        `${fixture.name}: the fixture line does not contain its own module \`${fixture.module}\``,
      );
      continue;
    }
    const measuredClass = classifyReferenceLine(fixture.line);
    if (measuredClass !== fixture.expectedClass) {
      failures.push(
        `${fixture.name}: expected class \`${fixture.expectedClass}\`, measured \`${measuredClass}\``,
      );
    }
    const measuredReachable = graph.reachable(referenceKey(fixture.module));
    if (measuredReachable !== fixture.expectedReachable) {
      failures.push(
        `${fixture.name}: expected reachable=${fixture.expectedReachable}, ` +
          `measured reachable=${measuredReachable} for \`${fixture.module}\``,
      );
    }
  }

  return failures;
}

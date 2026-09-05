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
 * ONE RECORDED MOVE of the pin: the count it took, the commit that made it,
 * and why.
 *
 * This shape replaces a prose audit trail that sat above a bare literal. The
 * prose stated the right rules — a lowering owes a reason, a raise is never
 * sanctioned — and nothing read it, so the rules held only for as long as
 * whoever moved the pin happened to re-read the comment. As data they are
 * graded by `gradePinLedger`, which probe #81 runs on every gate run.
 */
export interface UnreachablePinMove {
  /** The count the pin took at this move. */
  readonly value: number;
  /** The commit that made it — a short sha, resolvable in this repository. */
  readonly commit: string;
  /** Why it moved. A blank rationale is refused. */
  readonly rationale: string;
}

/**
 * Every move the pin has made, NEWEST FIRST. The head IS the pin.
 *
 * ONE LITERAL, deliberately. The count used to be written in three places that
 * had to agree byte-for-byte — here, in a sibling suite's `toBe(129)`, and in
 * shipped prose — so the sanctioned direction cost three coordinated edits and
 * a red file the lowering did not name. Lowering is now one prepended entry.
 *
 * STILL NOT COMPUTED AT LOAD, which was the original argument for a bare
 * literal and survives intact: a pin assigned from a call to the thing it pins
 * is a mirror of the implementation and can never disagree with it, which is
 * the one thing a pin exists to do. Deriving the constant from the head of a
 * hand-written list keeps it a written-down number; it stops being three of
 * them.
 *
 * RECOVERED FROM GIT, not from recollection: `git log -L` over the constant
 * yields all nine moves. The two oldest predate the prose trail entirely, so
 * their rationales come from their own commit messages and say so.
 */
export const ORDERED_UNREACHABLE_PIN_LEDGER: readonly UnreachablePinMove[] = [
  {
    value: 129,
    commit: "5017488",
    rationale:
      "M140/STE-543: the external-link verdicts probe imports the row parser " +
      "from `scan_design_references.ts` rather than copying it, and carries " +
      "its own `import.meta.main` front door, so that module became reachable " +
      "and its ordered references stopped naming a module nothing runnable " +
      "reaches. The drop is TRANSITIVE — a reader following probe #61's order " +
      "still cannot execute `scan_design_references.ts` by hand.",
  },
  {
    value: 130,
    commit: "6f62eb7",
    rationale:
      "M139/STE-541: the Linear branch mints its identity from the tracker, " +
      "which left `next_free_milestone_number.ts` with no runtime importer. " +
      "It was retargeted rather than deleted and given its own front door, so " +
      "its single ordered reference stopped naming an unreachable module. " +
      "Exactly one module left the set and none entered it.",
  },
  {
    value: 131,
    commit: "bc94a98",
    rationale:
      "M141/STE-545: `release_config.ts` gained a front door and now imports " +
      "`./docs_config` so the release writer honours `changelog_ci_owned`. " +
      "Reachability is transitive, so the two ordered references to " +
      "`docs_config.ts` stopped naming a module nothing runnable reaches.",
  },
  {
    value: 133,
    commit: "2a444ff",
    rationale:
      "M137/STE-535: grandfathering pre-epoch plans moved three references " +
      "into the reachable set. The commit records the move as the ratchet's " +
      "good direction without naming the three; recovered from git rather " +
      "than from a prose trail, and recorded here as the weaker evidence it is.",
  },
  {
    value: 136,
    commit: "8b97764",
    rationale:
      "M137/STE-534: `scan_fr_summary_altitude.ts` gained the " +
      "`import.meta.main` front door its sibling `scan_plan_narrative_" +
      "altitude.ts` had carried since it landed, so probe #67's registration " +
      "— which orders a reader to run BOTH scanners — stopped naming a module " +
      "nobody could run.",
  },
  {
    value: 137,
    commit: "a558449",
    rationale:
      "M137/STE-533: `stage_block_adoption.ts` gained the front door probe " +
      "#82's registration requires, and reachability is transitive, so two " +
      "ordered-and-unreachable references became ordered-and-reachable.",
  },
  {
    value: 139,
    commit: "60839ff",
    rationale:
      "M136/STE-527: `skip_baseline.ts` gained a `./branch_proposal` import, " +
      "which made three previously-unreachable ordered references reachable.",
  },
  {
    value: 142,
    commit: "a1f8cd9",
    rationale:
      "M135/STE-522: giving minting a home whose name is computable made four " +
      "ordered references reachable — the commit message names the count and " +
      "the direction, which is the whole record that survives from before the " +
      "prose trail began.",
  },
  {
    value: 146,
    commit: "b574073",
    rationale:
      "M133/STE-517: the count as this check itself first reported it. Not " +
      "a move — the origin, and the only entry with no predecessor. Nothing " +
      "here was carried from the design, the FR or the plan; the design's own " +
      "inventory figures measured NOT to reproduce, which is the argument for " +
      "generating this list rather than writing it down.",
  },
];

/**
 * The pinned count of references that are both ORDERED and UNREACHABLE across
 * the two shipped trees.
 *
 * DERIVED FROM THE LEDGER HEAD, so the number has exactly one home. When it
 * moves, the run reds. Lowering it is the fix; raising it is a decision to
 * ship one more order nobody can carry out, and `gradePinLedger` refuses that
 * rather than leaving it to a reader who may not be reading.
 */
export const ORDERED_UNREACHABLE_PIN: number = ORDERED_UNREACHABLE_PIN_LEDGER[0]!.value;

/** What `gradePinLedger` says about a ledger. */
export interface PinLedgerVerdict {
  /** True only when the ledger owes no refusal. */
  readonly ok: boolean;
  /** One sentence per refusal, each naming the move it refuses. */
  readonly refusals: readonly string[];
}

/**
 * The lowering ceremony, executed rather than described.
 *
 * Three rules, each of which used to live in prose above the constant:
 *
 *   * a move carries a rationale — a lowering with no recorded reason is a
 *     number nobody can audit later;
 *   * a move carries the commit that made it — an audit trail that cannot be
 *     resolved is decoration;
 *   * the pin never RISES. A raise admits one more order nobody can carry out,
 *     which is precisely the drift the pin exists to catch.
 *
 * A move that changes nothing is refused too: an entry recording the same
 * count as its predecessor records no fix, and would let the ledger grow while
 * the ceremony was skipped.
 */
export function gradePinLedger(ledger: readonly UnreachablePinMove[]): PinLedgerVerdict {
  const refusals: string[] = [];

  if (ledger.length === 0) {
    return {
      ok: false,
      refusals: [
        "the pin ledger is empty — the pin has no recorded value, and a count " +
          "nobody wrote down cannot be a pin",
      ],
    };
  }

  for (const move of ledger) {
    if (move.rationale.trim().length === 0) {
      refusals.push(
        `the move to ${move.value} (${move.commit || "no commit"}) carries no ` +
          "rationale — a lowering is sanctioned only with the reason recorded " +
          "beside it",
      );
    }
    if (move.commit.trim().length === 0) {
      refusals.push(
        `the move to ${move.value} names no commit — an audit trail that ` +
          "cannot be resolved is decoration",
      );
    }
  }

  // Newest first, so `ledger[i]` is the move that FOLLOWED `ledger[i + 1]`.
  for (let i = 0; i + 1 < ledger.length; i++) {
    const after = ledger[i]!;
    const before = ledger[i + 1]!;
    if (after.value > before.value) {
      refusals.push(
        `the pin was RAISED from ${before.value} to ${after.value} ` +
          `(${after.commit || "no commit"}) — a raise ships one more order ` +
          "nobody can carry out, which is the drift the pin exists to catch, " +
          "and is never sanctioned",
      );
    } else if (after.value === before.value) {
      refusals.push(
        `the move to ${after.value} (${after.commit || "no commit"}) moved ` +
          "nothing — an entry that changes no count records no fix",
      );
    }
  }

  return { ok: refusals.length === 0, refusals };
}

/**
 * The move `commit` made, for a sibling suite asserting about its OWN
 * milestone's landing value.
 *
 * This is the replacement for `expect(ORDERED_UNREACHABLE_PIN).toBe(<literal>)`
 * in a suite that does not own the pin. That assertion is true for exactly one
 * commit and reds every later lowering; this one is a fact about history and
 * stays true forever.
 */
export function pinLedgerMove(
  commit: string,
  ledger: readonly UnreachablePinMove[] = ORDERED_UNREACHABLE_PIN_LEDGER,
): UnreachablePinMove {
  const move = ledger.find((m) => m.commit === commit);
  if (move === undefined) {
    throw new Error(
      `the pin ledger records no move made by ${commit} — an assertion ` +
        "against a move the ledger does not carry asserts nothing",
    );
  }
  return move;
}

/**
 * The count the pin held immediately BEFORE `commit` moved it, or `null` for
 * the origin entry, which has no predecessor.
 */
export function pinValueBefore(
  commit: string,
  ledger: readonly UnreachablePinMove[] = ORDERED_UNREACHABLE_PIN_LEDGER,
): number | null {
  const index = ledger.findIndex((m) => m.commit === commit);
  if (index < 0) {
    throw new Error(
      `the pin ledger records no move made by ${commit} — an assertion ` +
        "against a move the ledger does not carry asserts nothing",
    );
  }
  const before = ledger[index + 1];
  return before === undefined ? null : before.value;
}

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
 * ordered-and-unreachable count against the head of `ledger`.
 *
 * TWO SUBJECTS, both graded here. The COUNT, which is what the probe has
 * always been about; and the LEDGER ITSELF, because the ceremony that governs
 * a move used to be prose above a bare literal and was therefore enforced by
 * nobody. A ledger that records a raise, or a move with no reason, is an error
 * in the gate's own report rather than a finding in one suite.
 *
 * `ledger` is a parameter so the ceremony can be driven over fixtures. The
 * default is the shipped ledger, so every existing call site is unchanged.
 *
 * SEVERITY IS NARROW BY DESIGN (AC-STE-517.12): the references this check
 * merely catalogues never fail the gate — they surface as ONE warning row
 * carrying the count. Only a count that has moved off the pin, or a ledger
 * that breaks the ceremony, is an error. A probe that redded every
 * pre-existing order would be silenced within a day.
 *
 * Vacuous — zero records, zero violations, `ok: true` — when the walk finds no
 * module reference at all, which is the state of a project that never
 * installed the toolkit's own sources. Nothing found and nothing looked at are
 * therefore distinguishable by `records`, never conflated in `ok`. A BROKEN
 * LEDGER IS NOT VACUOUS: it is a property of the shipped module, not of the
 * tree being scanned, so it is graded before the walk's own verdict.
 */
export async function runModuleReachabilityProbe(
  projectRoot: string,
  ledger: readonly UnreachablePinMove[] = ORDERED_UNREACHABLE_PIN_LEDGER,
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

  // THE CEREMONY, EXECUTED. Graded before anything about the scanned tree,
  // because a ledger that records a raise is wrong in a checkout that carries
  // no markdown at all.
  const verdict = gradePinLedger(ledger);
  for (const refusal of verdict.refusals) {
    const note = `${PROBE_MODULE_REL}:1 — ${refusal}`;
    violations.push({
      file: join(projectRoot, PROBE_MODULE_REL),
      line: 1,
      reason: refusal,
      note,
      severity: "error",
      message: [
        `${PROBE_ID}: ${note}`,
        "Remedy: a move of the pin is one prepended `ORDERED_UNREACHABLE_PIN_" +
          "LEDGER` entry carrying the new count, the commit that lands it, and " +
          "why the count fell. Lowering is the sanctioned direction; raising " +
          "the pin to admit a new unrunnable order is never sanctioned.",
        `Context: file=${PROBE_MODULE_REL}, line=1, probe=${PROBE_ID}, ` +
          "severity=error",
      ].join("\n"),
    });
  }

  const pin = ledger[0]?.value ?? ORDERED_UNREACHABLE_PIN;

  // Nothing looked at ⇒ nothing to grade ABOUT THE TREE. Vacuous, not a
  // verdict of zero — but a ledger refusal already recorded still stands.
  if (records.length === 0) {
    return { ok: verdict.ok, records, orderedUnreachable, violations };
  }

  if (orderedUnreachable === pin) {
    if (orderedUnreachable > 0) {
      const reason =
        `${orderedUnreachable} module references are ordered and unreachable — ` +
        `catalogued, at the pinned count (${pin})`;
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
            "and prepend a ledger entry recording the lower count and why.",
          `Context: file=${PROBE_MODULE_REL}, line=1, measured=${orderedUnreachable}, ` +
            `pin=${pin}, probe=${PROBE_ID}, severity=warning`,
        ].join("\n"),
      });
    }
    return { ok: verdict.ok, records, orderedUnreachable, violations };
  }

  const direction = orderedUnreachable > pin ? "grown" : "fallen";
  const offenders = records
    .filter(isOrderedUnreachable)
    .slice(0, 10)
    .map((r) => `${r.surface}:${r.line} ${r.module}`)
    .join("; ");
  const reason =
    `ordered-and-unreachable count has ${direction}: measured ${orderedUnreachable}, ` +
    `pinned ${pin}`;
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
        "landing: prepend an `ORDERED_UNREACHABLE_PIN_LEDGER` entry recording " +
        `${orderedUnreachable}, the commit that lands it, and why it fell. ` +
        "Never raise the pin to make a new order pass.",
      `Context: file=${PROBE_MODULE_REL}, line=1, measured=${orderedUnreachable}, ` +
        `pin=${pin}, probe=${PROBE_ID}, severity=error` +
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

// smoke_fixture_groups — STE-425: a machine-readable per-fixture-GROUP
// execution record for the `/smoke-test` driver's Phase 2.X summary, plus the
// renderer that turns it into operator-visible lines.
//
// THE DEFECT. Phase 2.X's summary vocabulary was binary — `M56 runtime checks:
// PASS (…)` or `<N> regressions surfaced` — and three of the eight group
// footers documented ONLY a PASS branch, so they literally could not render
// anything else. A group that never executed therefore contributed nothing,
// and "nothing" was indistinguishable from "green": on the 2026-07-27 Linear
// leg fixture group 2 never ran (wall-clock, not a blocker) and was absorbed
// into the aggregate instead of being named. Silence was read as a pass.
//
// THE FIX. The run keeps a record per group, reconciled against a CANONICAL
// roster rather than against whatever the run happened to mention, and the
// aggregate is computed from that record. A group the roster knows about and
// the run never spoke for is `not-reached`, which is never a pass.
//
// FOUR OUTCOMES, NOT THREE. `passed` / `failed` / `not-reached` are the three
// the FR asks for; `not-applicable` is the fourth, and it is load-bearing.
// Group 2 is Linear-ONLY by design (probe #26 is vacuous on Jira — adapter
// Schema M `project_milestone: false`), so on the Jira leg its silence is
// legitimate. Collapsing `not-reached` and `not-applicable` into one bucket
// would recreate the very ambiguity this module exists to remove, one level up:
// either every Jira run reports a phantom gap, or a real Linear-leg gap hides
// behind a by-design exemption.
//
// House precedent: `smoke_verdict.ts` is the per-LEG outcome model (outcome
// vocabulary + builder + reader + reconciliation + an `import.meta.main` CLI).
// This is its per-GROUP sibling and mirrors that shape deliberately.

// --- the vocabulary --------------------------------------------------------

/**
 * The four outcomes a fixture group can carry. Order is the reporting order
 * used by the summary head line.
 */
export const FIXTURE_GROUP_OUTCOMES = [
  "passed",
  "failed",
  "not-reached",
  "not-applicable",
] as const;

export type FixtureGroupOutcome = (typeof FIXTURE_GROUP_OUTCOMES)[number];

/**
 * The legs a tandem `/conformance-loop` run drives. THE authority — every other
 * statement of the leg set derives from this array, never from a second copy.
 */
export const SMOKE_LEGS = ["linear", "jira", "none"] as const;

export type SmokeLeg = (typeof SMOKE_LEGS)[number];

// --- the canonical roster --------------------------------------------------

/**
 * One entry per `#### Fixture group <N>` block in
 * `.claude/skills/smoke-test/SKILL.md` § Phase 2.X.
 *
 * `sut` is the token that group's runtime-check LINE actually prints, which is
 * not always the token in its heading: group 2's heading names STE-221 (the
 * test FR) while its line and diagnostics name STE-214 (the system under
 * test), and group 3's heading names STE-222 while its line names STE-215. The
 * diagnostic convention is "name the SUT, not the fixture's own FR", so the
 * roster follows the line, not the heading.
 *
 * `legs` is the by-design leg roster. Everything runs on every registered leg
 * except group 2, which is Linear-only because probe #26 — its system under
 * test — is vacuous on Jira.
 *
 * STE-446: this alias IS `SMOKE_LEGS`, not a parallel literal. The previous
 * hand-written copy is precisely why all eight rosters stayed static when the
 * enum was mutated during the M121 design measurement — the roster read the
 * copy and never saw the new leg. Aliasing keeps the rosters genuinely derived,
 * so widening the enum widens the coverage with it.
 */
const ALL_LEGS: readonly SmokeLeg[] = SMOKE_LEGS;

export interface FixtureGroupSpec {
  /** 1-based group number, matching the SKILL's `#### Fixture group <N>`. */
  group: number;
  /** The `STE-<N>` token this group's runtime-check line prints. */
  sut: string;
  /** The legs this group is expected to run on. */
  legs: readonly SmokeLeg[];
}

export const CANONICAL_FIXTURE_GROUPS: readonly FixtureGroupSpec[] = [
  { group: 1, sut: "STE-226", legs: ALL_LEGS },
  { group: 2, sut: "STE-214", legs: ["linear"] },
  { group: 3, sut: "STE-215", legs: ALL_LEGS },
  { group: 4, sut: "STE-227", legs: ALL_LEGS },
  { group: 5, sut: "STE-228", legs: ALL_LEGS },
  { group: 6, sut: "STE-230", legs: ALL_LEGS },
  { group: 7, sut: "STE-225", legs: ALL_LEGS },
  { group: 8, sut: "STE-350", legs: ALL_LEGS },
];

// --- records ---------------------------------------------------------------

/**
 * What the run reports for one group. Only `passed` and `failed` are outcomes
 * a fixture can genuinely OBSERVE; see `normalizeObserved`.
 */
export interface ObservedFixtureGroup {
  group: number;
  outcome: string;
}

/** A reconciled record — one per canonical group, always. */
export interface FixtureGroupRecord {
  group: number;
  sut: string;
  outcome: FixtureGroupOutcome;
}

/**
 * Fold order for duplicate observations of the SAME group: the worst wins, so
 * a stray later `passed` can never overwrite an earlier `failed`.
 */
const OBSERVED_SEVERITY: Record<FixtureGroupOutcome, number> = {
  passed: 0,
  "not-applicable": 1,
  "not-reached": 2,
  failed: 3,
};

function worse(
  a: FixtureGroupOutcome,
  b: FixtureGroupOutcome,
): FixtureGroupOutcome {
  return OBSERVED_SEVERITY[b] > OBSERVED_SEVERITY[a] ? b : a;
}

/**
 * Map a reported outcome onto the vocabulary, conservatively.
 *
 * Only `passed` and `failed` are believed as reported: they are the two states
 * a fixture that actually ran can be in. EVERYTHING else — a missing value, an
 * unrecognized token, a driver claiming `not-applicable` for a group the roster
 * says applies to this leg, or a disposition invented elsewhere in the driver
 * (STE-429's Phase 8 `inconclusive` is the live example) — degrades to
 * `not-reached`. That is the whole point: an unrecognized report is silence,
 * and silence is never a pass. `not-applicable` is derived from the roster in
 * `reconcileFixtureGroups`, never taken on the run's word.
 */
function normalizeObserved(outcome: unknown): FixtureGroupOutcome {
  if (outcome === "passed" || outcome === "failed") return outcome;
  return "not-reached";
}

function normalizeLeg(leg: unknown): string {
  return typeof leg === "string" ? leg.trim().toLowerCase() : "";
}

/**
 * Is this token a leg the enum REGISTERS? One spelling of the membership test,
 * shared by the two callers that ask it for opposite reasons — `appliesToLeg`
 * below, which treats an unregistered leg as "everything applies", and the
 * CLI's `--leg` guard, which refuses it outright. Naming it keeps the two
 * readings of the same fact from drifting into two spellings of it.
 */
function isRegisteredLeg(leg: string): boolean {
  return (SMOKE_LEGS as readonly string[]).includes(leg);
}

/**
 * True when this group is expected to run on this leg.
 *
 * An UNKNOWN leg token is treated as "everything applies": exempting a group
 * on a leg nobody recognizes would let a typo'd `--leg` silently convert a
 * real gap into a by-design N/A. Erring toward `not-reached` is the direction
 * that keeps the gap visible.
 */
function appliesToLeg(spec: FixtureGroupSpec, leg: string): boolean {
  if (!isRegisteredLeg(leg)) return true;
  return (spec.legs as readonly string[]).includes(leg);
}

/**
 * The canonical group numbers whose `legs` roster NAMES this leg, in roster
 * order. Empty when no group covers it.
 *
 * Roster-literal on purpose: this deliberately does NOT go through
 * `appliesToLeg`, whose everything-applies fallback would answer "all eight"
 * for a leg no group has ever heard of. That fallback is the right answer to
 * `appliesToLeg`'s question ("should this group have run?" — err toward keeping
 * the gap visible); it is the wrong answer to THIS one ("which groups signed up
 * for this leg?"), where the honest answer for an unrostered leg is nothing.
 * The emptiness is the signal the CLI guard reads.
 */
export function groupsCoveringLeg(leg: string): readonly number[] {
  const normalized = normalizeLeg(leg);
  return CANONICAL_FIXTURE_GROUPS.filter((spec) =>
    (spec.legs as readonly string[]).includes(normalized),
  ).map((spec) => spec.group);
}

/**
 * Reconcile what the run reported against the canonical roster.
 *
 * Always returns one record per canonical group, in roster order — the run
 * cannot shrink the denominator by staying quiet. Resolution per group:
 *
 * - An observed `failed` is never downgraded, not even on a leg where the
 *   group is n/a: something ran, and it failed.
 * - Otherwise a group outside this leg's roster is `not-applicable`.
 * - Otherwise an unreported group is `not-reached`.
 * - Otherwise the (normalized) observation stands.
 */
export function reconcileFixtureGroups(
  observed: readonly ObservedFixtureGroup[],
  leg: string,
): readonly FixtureGroupRecord[] {
  const reported = new Map<number, FixtureGroupOutcome>();
  for (const entry of observed ?? []) {
    if (entry === null || typeof entry !== "object") continue;
    const group = (entry as ObservedFixtureGroup).group;
    if (typeof group !== "number" || !Number.isInteger(group)) continue;
    const outcome = normalizeObserved((entry as ObservedFixtureGroup).outcome);
    const prior = reported.get(group);
    reported.set(group, prior === undefined ? outcome : worse(prior, outcome));
  }

  const normalizedLeg = normalizeLeg(leg);
  return CANONICAL_FIXTURE_GROUPS.map((spec) => {
    const seen = reported.get(spec.group);
    let outcome: FixtureGroupOutcome;
    if (seen === "failed") {
      outcome = "failed";
    } else if (!appliesToLeg(spec, normalizedLeg)) {
      outcome = "not-applicable";
    } else if (seen === undefined) {
      outcome = "not-reached";
    } else {
      outcome = seen;
    }
    return { group: spec.group, sut: spec.sut, outcome };
  });
}

// --- rendering -------------------------------------------------------------

/**
 * The operator-visible label per outcome. `PASS` and `FAIL` are byte-pinned by
 * `tests/smoke-test-ste352-stream-capture.test.ts` (via the SKILL's
 * `STE-350 runtime check: PASS` / `… FAIL` literals) — the two new outcomes
 * therefore had to take labels that are NEITHER, so no substring search for a
 * pass can match an unreached group.
 */
const OUTCOME_LABELS: Record<FixtureGroupOutcome, string> = {
  passed: "PASS",
  failed: "FAIL",
  "not-reached": "NOT-REACHED",
  "not-applicable": "N/A",
};

/** `<sut> runtime check: PASS|FAIL|NOT-REACHED|N/A` — one group, one line. */
export function renderFixtureGroupLine(record: FixtureGroupRecord): string {
  const label = OUTCOME_LABELS[record.outcome];
  if (label === undefined) {
    throw new Error(
      `renderFixtureGroupLine: unknown outcome ${JSON.stringify(record.outcome)} ` +
        `for fixture group ${record.group} — expected one of ` +
        FIXTURE_GROUP_OUTCOMES.join(" | "),
    );
  }
  return `${record.sut} runtime check: ${label}`;
}

/** Tally of the four outcomes across a record set. */
export type FixtureGroupCounts = Record<FixtureGroupOutcome, number>;

export function countFixtureGroupOutcomes(
  records: readonly FixtureGroupRecord[],
): FixtureGroupCounts {
  const counts: FixtureGroupCounts = {
    passed: 0,
    failed: 0,
    "not-reached": 0,
    "not-applicable": 0,
  };
  for (const record of records) {
    if (record.outcome in counts) counts[record.outcome] += 1;
  }
  return counts;
}

/**
 * The run's fixture-group verdict.
 *
 * `pass` only when the FULL canonical roster is represented AND every record
 * is `passed` or `not-applicable`. The roster check is not ceremony: without
 * it, a record set that simply omits a group would pass, which is the exact
 * silence-reads-as-green defect one layer up from the one this module fixes.
 * A `not-reached` record therefore fails the run, and so does an empty set.
 */
export function fixtureGroupsAggregate(
  records: readonly FixtureGroupRecord[],
): "pass" | "fail" {
  const present = new Set(records.map((record) => record.group));
  for (const spec of CANONICAL_FIXTURE_GROUPS) {
    if (!present.has(spec.group)) return "fail";
  }
  for (const record of records) {
    if (record.outcome !== "passed" && record.outcome !== "not-applicable") {
      return "fail";
    }
  }
  return "pass";
}

/**
 * The Phase 2.X block: a head line carrying the aggregate and the four counts,
 * then one line per group in roster order.
 *
 * Every group appears, including the ones that did not run — that is what makes
 * the block falsifiable. An n/a-by-design group is counted separately from an
 * unreached one, so it neither spends the run's pass budget nor forges a gap.
 */
export function renderFixtureGroupSummary(
  records: readonly FixtureGroupRecord[],
): string {
  const counts = countFixtureGroupOutcomes(records);
  const verdict = fixtureGroupsAggregate(records) === "pass" ? "PASS" : "FAIL";
  const head =
    `Fixture groups: ${verdict} — ${counts.passed} passed, ` +
    `${counts.failed} failed, ${counts["not-reached"]} not-reached, ` +
    `${counts["not-applicable"]} n/a`;
  return [head, ...records.map(renderFixtureGroupLine)].join("\n");
}

// --- CLI shim --------------------------------------------------------------
//
// Mirrors smoke_verdict.ts: a thin `import.meta.main` wrapper over the pure
// functions above, so the driver SKILL can call one bun command from a bash
// fence instead of tallying groups in prose.
//
// Usage:
//   bun smoke_fixture_groups.ts render --leg <linear|jira>
//                                      [--passed "1 3 4"] [--failed "5"]
//
// Groups named by neither flag are `not-reached` (or `not-applicable` when the
// leg's roster excludes them). Prints the summary block on stdout and exits 0
// when the aggregate is `pass`, 1 when it is `fail` — so the driver's rc can
// carry the fixture-group verdict without the driver re-deriving it. Bad input
// exits 2, the same usage code smoke_verdict.ts uses, so a malformed
// invocation is never mistaken for either verdict.

const USAGE =
  "usage: bun smoke_fixture_groups.ts render --leg <linear|jira> " +
  '[--passed "1 3 4"] [--failed "5"]';

function parseArgs(argv: readonly string[]): Record<string, string[]> {
  const flags: Record<string, string[]> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value =
      argv[i + 1] !== undefined && !argv[i + 1]!.startsWith("--")
        ? argv[++i]!
        : "";
    (flags[key] ??= []).push(value);
  }
  return flags;
}

function first(
  flags: Record<string, string[]>,
  key: string,
): string | undefined {
  return flags[key]?.[0];
}

function groupList(values: readonly string[] | undefined): number[] {
  return (values ?? [])
    .flatMap((value) => value.split(/[\s,]+/))
    .filter(Boolean)
    .map((token) => Number.parseInt(token, 10))
    .filter((n) => Number.isInteger(n));
}

if (import.meta.main) {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseArgs(rest);

  if (command === "render") {
    // Mirrors smoke_verdict.ts's `--tracker` guard. `appliesToLeg`'s
    // everything-applies fallback for an unrecognized leg is the right library
    // behaviour — it keeps a gap visible — but at the CLI boundary it converts
    // `--leg jirra` into a phantom group-2 gap the operator then chases, when
    // the real fault is the flag. So the CLI refuses the leg instead of
    // computing an answer for a leg nobody named.
    const legRaw = first(flags, "leg");
    const leg = normalizeLeg(legRaw);
    if (!isRegisteredLeg(leg)) {
      console.error(
        `smoke_fixture_groups: --leg must be one of ${SMOKE_LEGS.join(" | ")} ` +
          `(got ${JSON.stringify(legRaw ?? "")})\n${USAGE}`,
      );
      process.exit(2);
    }
    // The second boundary refusal, and it guards the OTHER direction. The check
    // above rejects a leg `SMOKE_LEGS` does not know; this one rejects a leg
    // `SMOKE_LEGS` DOES know that no fixture group rosters. Such a leg clears
    // the guard above, then fails `appliesToLeg` for all eight groups, so every
    // record reconciles to `not-applicable`, `fixtureGroupsAggregate` calls that
    // set a pass, and the CLI exits 0 — a leg that checked nothing reporting
    // green. That is this module's own defect one level up, and it becomes
    // reachable the moment `SMOKE_LEGS` grows without the roster growing with
    // it. Refuse, mirroring the `--leg` guard: exit 2, so the vacuous render is
    // never mistaken for either verdict.
    const covering = groupsCoveringLeg(leg);
    if (covering.length === 0) {
      console.error(
        `smoke_fixture_groups: leg ${JSON.stringify(leg)} is registered in ` +
          `SMOKE_LEGS but no fixture group rosters it — every group would ` +
          `render not-applicable and the run would report a vacuous pass. Add ` +
          `the leg to a group's \`legs\` roster, or drop it from SMOKE_LEGS.\n` +
          USAGE,
      );
      process.exit(2);
    }
    const observed: ObservedFixtureGroup[] = [
      ...groupList(flags["passed"]).map((group) => ({
        group,
        outcome: "passed",
      })),
      ...groupList(flags["failed"]).map((group) => ({
        group,
        outcome: "failed",
      })),
    ];
    // A group number outside the roster is a typo, and `reconcileFixtureGroups`
    // drops it by construction (it folds onto the canonical roster). Dropping is
    // the safe direction — the group the caller MEANT stays `not-reached` — but
    // dropping SILENTLY is the failure mode this whole module exists to remove,
    // so name it. rc is unaffected: the eight canonical records still decide it.
    const known = new Set(CANONICAL_FIXTURE_GROUPS.map((spec) => spec.group));
    const stray = [...new Set(observed.map((entry) => entry.group))]
      .filter((group) => !known.has(group))
      .sort((a, b) => a - b);
    if (stray.length > 0) {
      console.error(
        `smoke_fixture_groups: ignoring group number(s) outside the canonical ` +
          `roster: ${stray.join(", ")}`,
      );
    }
    const records = reconcileFixtureGroups(observed, leg);
    console.log(renderFixtureGroupSummary(records));
    process.exit(fixtureGroupsAggregate(records) === "pass" ? 0 : 1);
  }

  console.error(USAGE);
  process.exit(2);
}

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
 * `legs` is the by-design leg roster and `rationale` is the one-line reason it
 * takes that shape (STE-449). The rationale is not decoration: before STE-449
 * seven of the eight rosters were `ALL_LEGS` by inheritance rather than by
 * derivation, so nobody could tell a group that had been audited onto every leg
 * from one that had simply never been asked. Every entry now states what its
 * assertion depends on, which is what makes a future widening reviewable.
 *
 * STE-446: this alias IS `SMOKE_LEGS`, not a parallel literal. The previous
 * hand-written copy is precisely why all eight rosters stayed static when the
 * enum was mutated during the M121 design measurement — the roster read the
 * copy and never saw the new leg. Aliasing keeps the rosters genuinely derived,
 * so widening the enum widens the coverage with it.
 *
 * STE-449 AUDIT RESULT, recorded because the shape reads as a regression:
 * group 4 is NOT on the alias. It is the one group whose exclusion is a
 * property of the fixture rather than of the system under test — see its
 * rationale. Group 2 is excluded because its SUT is vacuous elsewhere. The two
 * reasons are different and the distinction is load-bearing: group 2 will never
 * gain a leg, group 4 gains one the moment a tracker-less sub-fixture is
 * written.
 *
 * STE-450 adds a THIRD reason class, and it points the other way. Groups 2 and
 * 4 are exempt FROM the tracker-less leg; group 9 is exempt from the TRACKER
 * legs, because the two probes its first two sub-fixtures exercise do not
 * merely go vacuous under a tracker — they INVERT, demanding the opposite of
 * what they demand under `mode: none`. (Its third sub-fixture rides along on
 * the ordinary vacuity case; the group's roster is set by the inverting pair,
 * which is why the rationale names only those two.) That inversion is why a
 * partial roster here is evidence rather than an exception: until group 9
 * existed, every roster was either the full alias or a subset of
 * `{linear, jira}`, so nothing distinguished a genuinely N-way `legs` field
 * from a two-state flag wearing a list's clothing.
 *
 * STE-451 adds group 10 on the same leg and it is NOT a second instance of
 * group 9's reason. Group 9 is exempt from the tracker legs by INVERSION —
 * probes #13 and #73 demand the opposite there. Group 10 is exempt because the
 * ARTIFACT it observes does not exist on a tracker leg at all: `claimLock`
 * writes `.dpt/locks/<id>` only under `mode: none`, and under a tracker the
 * same claim writes to the ticket instead. So this is vacuity with a NAMED
 * SUBSTITUTE — the evidence a tracker leg carries for the same property is the
 * ticket's `In Progress`/`Done` transition, asserted by Phase 4's ticket row —
 * rather than group 2's vacuity, where nothing carries it anywhere. Recorded
 * as its own reason rather than counted alongside the others, because "how
 * many exemptions are there" has never been the useful question; "what is each
 * one's reason, and can it ever be retired" is. This one is permanent for the
 * same structural reason group 2's is: a tracker leg has no lock file to look
 * at, however well it runs.
 */
const ALL_LEGS: readonly SmokeLeg[] = SMOKE_LEGS;

export interface FixtureGroupSpec {
  /** 1-based group number, matching the SKILL's `#### Fixture group <N>`. */
  group: number;
  /** The `STE-<N>` token this group's runtime-check line prints. */
  sut: string;
  /** The legs this group is expected to run on. */
  legs: readonly SmokeLeg[];
  /**
   * One line: what this group's assertion depends on, and therefore why its
   * roster is what it is. Required and non-empty for every group (STE-449).
   */
  rationale: string;
}

export const CANONICAL_FIXTURE_GROUPS: readonly FixtureGroupSpec[] = [
  {
    group: 1,
    sut: "STE-226",
    legs: ALL_LEGS,
    rationale:
      "the auto-approve marker gates /spec-write's draft and commit prompts, which exist in every mode; no assertion reads a tracker",
  },
  {
    group: 2,
    sut: "STE-214",
    legs: ["linear"],
    rationale:
      "probe #26's milestone-attach keys need an adapter declaring Schema M project_milestone: true — Linear alone; Jira declares false and a tracker-less project has no adapter at all",
  },
  {
    group: 3,
    sut: "STE-215",
    legs: ALL_LEGS,
    rationale:
      "the Phase 4b' propagation hook and probe #37 read cross-cutting spec files and git history; the SKILL states the hook is adapter-agnostic",
  },
  {
    group: 4,
    sut: "STE-227",
    legs: ["linear", "jira"],
    rationale:
      "constituted as exactly two tracker-parameterized sub-fixtures (4a/4b) whose step-4 assertion reads a tracker ticket reaching Done; no tracker-less sub-fixture exists to run",
  },
  {
    group: 5,
    sut: "STE-228",
    legs: ALL_LEGS,
    rationale:
      "STE-228's universal pre-commit branch gate has no tracker awareness and /spec-write calls it unconditionally, so the marker contract fires identically with no tracker configured",
  },
  {
    group: 6,
    sut: "STE-230",
    legs: ALL_LEGS,
    rationale:
      "spec-research retrieves related FRs from the specs/frs/ tree on disk; none of its three audit rows depends on a tracker",
  },
  {
    group: 7,
    sut: "STE-225",
    legs: ALL_LEGS,
    rationale:
      "counts tdd-result fences in the /implement capture; the orchestrator's fork contract is tracker-independent",
  },
  {
    group: 8,
    sut: "STE-350",
    legs: ALL_LEGS,
    rationale:
      "asserts a nested claude -p completes non-empty under the settings allow-list — a permission-layer property with no tracker surface",
  },
  {
    group: 9,
    sut: "STE-321",
    legs: ["none"],
    rationale:
      "probes #13 and #73 INVERT under a tracker mode — there they demand a tracker block and forbid the minted id — so their tracker-less enforcing arms are unreachable from any leg that configures a tracker",
  },
  {
    group: 10,
    sut: "STE-382",
    legs: ["none"],
    rationale:
      "`.dpt/locks/<id>` is written only by LocalProvider.claimLock, which runs only under mode: none — a tracker leg's claim writes to the ticket, so there is no lock file there to observe at any point in the run",
  },
  {
    group: 11,
    sut: "STE-464",
    legs: ALL_LEGS,
    rationale:
      "the /deliver refusal fence reads stdin tty-ness only — no tracker surface is consulted, so every leg exercises the headless refusal identically",
  },
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
 * `appliesToLeg`, whose everything-applies fallback would answer "every group"
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
//   bun smoke_fixture_groups.ts render --leg <leg>
//                                      [--passed "1 3 4"] [--failed "5"]
//   bun smoke_fixture_groups.ts legs
//
// `legs` prints the registered leg set, one space-separated line, and exits 0.
// It exists so a driver bash fence can RESOLVE the leg set instead of restating
// it: `/conformance-loop` pre-flight (0) reads it to expand a `--legs`
// selection and to refuse an empty one (STE-447). Reading the authority here is
// what keeps that gate from becoming a fourth hand-maintained copy of the leg
// list — the second-hardcoded-copy failure STE-446 exists to have ended.
// (Deliberately not naming the identifier STE-446 deleted: its AC.1 pins a
// zero-hit grep for that name across adapters/ and tests/, and a comment
// mentioning it would satisfy the grep while the copy stays gone. Rewording
// here is cheaper than weakening a shipped predecessor's pin.)
//
// Groups named by neither flag are `not-reached` (or `not-applicable` when the
// leg's roster excludes them). Prints the summary block on stdout and exits 0
// when the aggregate is `pass`, 1 when it is `fail` — so the driver's rc can
// carry the fixture-group verdict without the driver re-deriving it. Bad input
// exits 2, the same usage code smoke_verdict.ts uses, so a malformed
// invocation is never mistaken for either verdict.

// The supported-leg alternation is DERIVED, never restated. Before STE-447 this
// line read `--leg <linear|jira>` while the `--leg` guard immediately below it
// refused with all three registered legs named — one invocation printing two
// different supported-set claims, recorded as loose end (a) in
// specs/notes/follow-ups.md and closed here.
const USAGE =
  `usage: bun smoke_fixture_groups.ts render --leg <${SMOKE_LEGS.join("|")}> ` +
  '[--passed "1 3 4"] [--failed "5"]\n' +
  "       bun smoke_fixture_groups.ts legs";

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

  // STE-447: the authority, printed. One line, space-separated, in registry
  // order — the shape `/conformance-loop` pre-flight (0) word-splits directly.
  if (command === "legs") {
    console.log(SMOKE_LEGS.join(" "));
    process.exit(0);
  }

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
    // the guard above, then fails `appliesToLeg` for every group, so every
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
    // so name it. rc is unaffected: the canonical records still decide it.
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

// shared_tracker_scenarios — STE-616 (What gets built, item 3).
//
// The closed registry of shared-tracker scenarios: two repositories acting on
// one tracker container. Per id it carries the trackers the scenario applies
// to, a one-line property, whether the live smoke may run it, and the
// invocation kinds the scenario must record (AC-STE-616.14 — a scenario that
// records zero invocations of a declared kind is vacuous).
//
// The offline suite (m_2306b6-ste-616-shared-tracker-scenarios) and the live
// smoke (STE-617) both read this list, so the offline and live scenario sets
// cannot drift. AC-STE-616.4 grades it by name: every id has exactly one test
// per tracker it applies to.
//
// `LINEAR_ISSUE_BUDGET` is the number of Linear issues the live smoke may
// spend. S15..S18 create no tracker issue (S15 is offline-only; S16..S18 make
// no tracker call), so they leave it unchanged.

export type SharedTrackerId = "jira" | "linear";

export type SharedTrackerInvocationKind =
  | "front-door"
  | "tracker-write-hook"
  | "commit-pr-hook"
  | "detector"
  | "gate-probe";

export interface SharedTrackerScenario {
  readonly id: string;
  readonly trackers: readonly SharedTrackerId[];
  readonly property: string;
  readonly invocations: readonly SharedTrackerInvocationKind[];
  readonly live: boolean;
  readonly offlineReason?: string;
}

const BOTH: readonly SharedTrackerId[] = ["jira", "linear"];

export const SHARED_TRACKER_SCENARIOS: readonly SharedTrackerScenario[] = [
  { id: "S1", trackers: BOTH, live: true, invocations: ["front-door", "tracker-write-hook"], property: "Two repositories coexisting in one container each create an FR with the same title (incl. dash, NBSP, whitespace variants) and neither binds the other's ticket." },
  { id: "S2", trackers: BOTH, live: true, invocations: ["front-door", "tracker-write-hook"], property: "Inside one joined milestone, same-title FRs from two repositories are separated by the repo tag alone." },
  { id: "S3", trackers: BOTH, live: true, invocations: ["front-door", "tracker-write-hook"], property: "B joins A's milestone only by explicit key; a coincident milestone title is never a silent bind." },
  { id: "S4", trackers: BOTH, live: true, invocations: ["front-door", "detector"], property: "Each repository's orphan listing is scoped to its own tag, and the untagged detector flags only untagged tickets." },
  { id: "S5", trackers: BOTH, live: true, invocations: ["front-door"], property: "The ship gate refuses while the sibling is busy on the joined milestone and permits when it is idle or busy elsewhere." },
  { id: "S6", trackers: BOTH, live: true, invocations: ["front-door", "tracker-write-hook"], property: "A client below the target's min_dpt_version is refused; at and above the floor it is permitted." },
  { id: "S7", trackers: BOTH, live: true, invocations: ["front-door", "tracker-write-hook"], property: "A write without a valid, own-session receipt matching the tool input is refused." },
  { id: "S8", trackers: BOTH, live: true, invocations: ["front-door"], property: "Repointing a repository into the shared container refuses until every precondition holds and leaves the sibling untouched." },
  { id: "S9", trackers: BOTH, live: true, invocations: ["front-door", "tracker-write-hook"], property: "A cross-repository write is graded against the target repository, and an unresolvable target is refused." },
  { id: "S10", trackers: BOTH, live: true, invocations: ["front-door", "detector"], property: "An untagged ticket written by an old client is surfaced by the detector." },
  { id: "S11", trackers: BOTH, live: true, invocations: ["front-door", "tracker-write-hook", "detector"], property: "A relocated checkout, a pre-declaration branch and an unreadable declaration are never read as undeclared." },
  { id: "S12", trackers: BOTH, live: true, invocations: ["commit-pr-hook"], property: "Commit and PR hooks grade evidence by the repository written to, not the session's own." },
  { id: "S13", trackers: BOTH, live: true, invocations: ["front-door", "tracker-write-hook"], property: "Claim and import respect ticket ownership by repository and project." },
  { id: "S14", trackers: BOTH, live: true, invocations: ["front-door", "tracker-write-hook"], property: "Joining, spanning and releasing a milestone write nothing beyond what they decided." },
  { id: "S15", trackers: ["jira"], live: false, offlineReason: "its fixture needs seeded tickets carrying a numeric label, which the live smoke cannot seed without spending tracker issues", invocations: ["detector"], property: "A numeric milestone label shared by two repositories is flagged as a collision." },
  { id: "S16", trackers: BOTH, live: true, invocations: ["front-door", "gate-probe"], property: "A new numeric M<N> milestone in tracker mode is refused by the typed door and the gate probe." },
  { id: "S17", trackers: BOTH, live: true, invocations: ["commit-pr-hook"], property: "Every commit-writing git subcommand and alias is recognised as a commit; fast-forward merges are not." },
  { id: "S18", trackers: BOTH, live: true, invocations: ["commit-pr-hook"], property: "The /tdd hook's Reminders are visible rather than silently exiting 0." },
];

/** The closed id list, in registry order. */
export const SHARED_TRACKER_SCENARIO_IDS: readonly string[] = SHARED_TRACKER_SCENARIOS.map((s) => s.id);

/** Linear issues the live smoke may spend (unchanged by S15..S18). */
export const LINEAR_ISSUE_BUDGET = 7;

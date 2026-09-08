// STE-575 — /pr transitions the ticket forward only.
//
// The post-create step issues `transition_status(ticket, in_review)` every time,
// without reading where the ticket already is. On a project whose review lane
// sits behind its done lane, that drags a finished ticket backwards and the next
// gate run reads the result as genuine drift.
//
// ---------------------------------------------------------------------------
// Why every load-bearing arm below builds its OWN config
// ---------------------------------------------------------------------------
//
// This repository's `specs/tracker-config.yaml` declares `in_review: In Progress`
// — the review lane is COLLAPSED onto in-progress here. An end-to-end arm built
// on that config would satisfy AC.3's no-review-lane clause and would therefore
// prove nothing whatever about AC.2's forward-only clause: the skip it observed
// would be the wrong skip. Every arm here declares a synthetic config instead,
// and `THREE_LANE` is guarded (below) to be a genuine three-lane project whose
// in-review status is distinct from BOTH in-progress and done.
//
// The two skip clauses are tested against separate fixtures for the same reason:
// a single config that trips both cannot show which one fired.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { mutate } from "./_fence";
import * as trackerConfigModule from "../adapters/_shared/src/tracker_config";
import {
  roleToStatus,
  statusToRole,
  type TrackerConfig,
} from "../adapters/_shared/src/tracker_config";
import { routeWithTolerance } from "../adapters/_shared/src/tolerance_probe_routing";
import { activeTicketDriftPasses } from "../adapters/_shared/src/active_ticket_drift_predicate";
import type { PlanTaskState } from "../adapters/_shared/src/plan_task_state";

const pluginRoot = join(import.meta.dir, "..");
const read = (p: string) => readFileSync(join(pluginRoot, p), "utf-8");

// ---------------------------------------------------------------------------
// The subject under test — resolved through the module namespace, not a named
// import, so a missing export reds one assertion per AC instead of failing the
// whole file to link (which would make every AC below unresolvable).
// ---------------------------------------------------------------------------

interface Decision {
  action: "transition" | "skip";
  reason: string;
}

type Decider = (observedStatus: string, config: TrackerConfig | null) => Decision;

function subject(): Decider {
  const fn = (trackerConfigModule as unknown as Record<string, unknown>)[
    "prTransitionDecision"
  ];
  if (typeof fn !== "function") {
    throw new Error(
      "prTransitionDecision is not exported from adapters/_shared/src/tracker_config " +
        `(got ${typeof fn}) — the /pr post-create decision has no pure helper to test`,
    );
  }
  return fn as Decider;
}

const decide: Decider = (observedStatus, config) => subject()(observedStatus, config);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A genuine three-lane project: review lane distinct from in-progress AND done. */
const THREE_LANE: TrackerConfig = {
  tracker_key: "linear",
  statuses: ["Backlog", "In Progress", "In Review", "Done"],
  roles: {
    initial: "Backlog",
    in_progress: "In Progress",
    in_review: "In Review",
    done: "Done",
  },
};

/** THREE_LANE plus a declared status bound to no role (known-non-key). */
const WITH_NON_KEY: TrackerConfig = {
  ...THREE_LANE,
  statuses: [...THREE_LANE.statuses, "In QA"],
};

/** No review lane: `in_review` is byte-identical to `in_progress`. */
const COLLAPSED: TrackerConfig = {
  tracker_key: "linear",
  statuses: ["Backlog", "In Progress", "Done"],
  roles: {
    initial: "Backlog",
    in_progress: "In Progress",
    in_review: "In Progress",
    done: "Done",
  },
};

/** Near-miss: the two labels differ by one byte of case, so a lane DOES exist. */
const NEAR_MISS: TrackerConfig = {
  tracker_key: "linear",
  statuses: ["Backlog", "In Progress", "In progress", "Done"],
  roles: {
    initial: "Backlog",
    in_progress: "In Progress",
    in_review: "In progress",
    done: "Done",
  },
};

/** A project whose done lane is NOT spelled "Done" — role-driven, not literal. */
const RENAMED_DONE: TrackerConfig = {
  tracker_key: "linear",
  statuses: ["Icebox", "Building", "Reviewing", "Shipped"],
  roles: {
    initial: "Icebox",
    in_progress: "Building",
    in_review: "Reviewing",
    done: "Shipped",
  },
};

describe("STE-575 fixture integrity", () => {
  test("THREE_LANE really declares a review lane distinct from in-progress and done", () => {
    expect(THREE_LANE.roles.in_review).not.toBe(THREE_LANE.roles.in_progress);
    expect(THREE_LANE.roles.in_review).not.toBe(THREE_LANE.roles.done);
    expect(statusToRole(THREE_LANE, "In Review")).toBe("in_review");
    expect(statusToRole(THREE_LANE, "Done")).toBe("done");
  });

  test("COLLAPSED really has no review lane, and NEAR_MISS really has one", () => {
    expect(COLLAPSED.roles.in_review).toBe(COLLAPSED.roles.in_progress);
    expect(NEAR_MISS.roles.in_review).not.toBe(NEAR_MISS.roles.in_progress);
    expect(NEAR_MISS.roles.in_review.toLowerCase()).toBe(
      NEAR_MISS.roles.in_progress.toLowerCase(),
    );
  });

  test("WITH_NON_KEY really carries a declared status bound to no role", () => {
    expect(statusToRole(WITH_NON_KEY, "In QA")).toBeNull();
    expect(statusToRole(WITH_NON_KEY, "Blocked")).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-575.1 — a pure helper returning { action, reason }
// ---------------------------------------------------------------------------

describe("AC-STE-575.1 — prTransitionDecision is a pure, decidable helper", () => {
  test("returns an { action, reason } record whose action is one of the two verbs", () => {
    const d = decide("In Progress", THREE_LANE);
    expect(["transition", "skip"]).toContain(d.action);
    expect(typeof d.reason).toBe("string");
  });

  test("is decidable from an in-memory config alone — no specs dir, no tracker", () => {
    // The config is a literal that exists nowhere on disk; a helper that read a
    // file or called a tracker could not answer for it.
    const orphan: TrackerConfig = {
      tracker_key: "no-such-adapter-ste575",
      statuses: ["Nowhere", "Somewhere", "Elsewhere", "Finished"],
      roles: {
        initial: "Nowhere",
        in_progress: "Somewhere",
        in_review: "Elsewhere",
        done: "Finished",
      },
    };
    expect(decide("Somewhere", orphan).action).toBe("transition");
    expect(decide("Finished", orphan).action).toBe("skip");
  });

  test("is pure: repeated calls on the same inputs return the same decision", () => {
    const first = decide("Done", THREE_LANE);
    const second = decide("Done", THREE_LANE);
    const third = decide("Done", THREE_LANE);
    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  test("does not mutate the config it is handed", () => {
    const before = JSON.stringify(THREE_LANE);
    decide("Done", THREE_LANE);
    decide("In Progress", THREE_LANE);
    expect(JSON.stringify(THREE_LANE)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-575.2 — the forward-only clause
// ---------------------------------------------------------------------------

describe("AC-STE-575.2 — done role skips", () => {
  test("observed status mapping to the done role returns skip", () => {
    expect(statusToRole(THREE_LANE, "Done")).toBe("done");
    expect(decide("Done", THREE_LANE).action).toBe("skip");
  });

  test("the clause is role-driven, not a literal match on the word 'Done'", () => {
    // A naive `observedStatus === "Done"` implementation passes the arm above
    // and reds here.
    expect(statusToRole(RENAMED_DONE, "Shipped")).toBe("done");
    expect(decide("Shipped", RENAMED_DONE).action).toBe("skip");
  });

  test("a status merely CONTAINING the done label does not skip", () => {
    // "Done" is not declared in RENAMED_DONE's statuses at all.
    expect(decide("Done", RENAMED_DONE).action).toBe("transition");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-575.3 — the no-review-lane clause
// ---------------------------------------------------------------------------

describe("AC-STE-575.3 — a collapsed review lane skips", () => {
  test("in_review byte-identical to in_progress skips, whatever the observed status", () => {
    expect(decide("In Progress", COLLAPSED).action).toBe("skip");
    expect(decide("Backlog", COLLAPSED).action).toBe("skip");
  });

  test("the comparison is byte-identity, not case-insensitive equality", () => {
    // NEAR_MISS's two labels differ only in case. A lane that exists must be
    // written to, so this is a transition — a case-folding comparison reds here.
    expect(decide("Backlog", NEAR_MISS).action).toBe("transition");
    expect(decide("In Progress", NEAR_MISS).action).toBe("transition");
  });

  test("this clause is distinct from the done clause — it fires on a non-done status", () => {
    expect(statusToRole(COLLAPSED, "Backlog")).toBe("initial");
    expect(decide("Backlog", COLLAPSED).action).toBe("skip");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-575.4 — everything else transitions (today's behaviour preserved)
// ---------------------------------------------------------------------------

describe("AC-STE-575.4 — every other case transitions", () => {
  const cases: Array<[string, string, TrackerConfig | null]> = [
    ["initial status", "Backlog", THREE_LANE],
    ["in-progress status", "In Progress", THREE_LANE],
    ["in-review status", "In Review", THREE_LANE],
    ["unknown status", "Blocked", THREE_LANE],
    ["known-non-key status", "In QA", WITH_NON_KEY],
    ["empty status string", "", THREE_LANE],
    ["absent config", "In Progress", null],
    ["absent config with a done-looking status", "Done", null],
  ];

  for (const [label, status, config] of cases) {
    test(`${label} → transition`, () => {
      expect(decide(status, config).action).toBe("transition");
    });
  }
});

// ---------------------------------------------------------------------------
// AC-STE-575.5 — every skip is reported in plain words
// ---------------------------------------------------------------------------

describe("AC-STE-575.5 — every skip carries a non-empty reason naming the status", () => {
  const skips: Array<[string, string, TrackerConfig]> = [
    ["forward-only clause", "Done", THREE_LANE],
    ["forward-only clause, renamed done lane", "Shipped", RENAMED_DONE],
    ["no-review-lane clause", "In Progress", COLLAPSED],
    ["no-review-lane clause, non-done status", "Backlog", COLLAPSED],
  ];

  for (const [label, status, config] of skips) {
    test(`${label}: reason is non-empty and names \`${status}\``, () => {
      const d = decide(status, config);
      expect(d.action).toBe("skip");
      expect(d.reason.trim().length).toBeGreaterThan(0);
      expect(d.reason).toContain(status);
    });
  }

  test("the two clauses give distinguishable reasons", () => {
    // A single shared string would make an over-fire indistinguishable from
    // correct behaviour — which is the whole point of reporting the skip.
    const forwardOnly = decide("Done", THREE_LANE).reason;
    const noLane = decide("In Progress", COLLAPSED).reason;
    expect(forwardOnly).not.toBe(noLane);
  });

  test("/pr's tracker-mode section instructs the skip to be reported, not swallowed", () => {
    const body = read("skills/pr/SKILL.md");
    const region = section(body, /^##\s+Tracker Mode Probe\b/);
    expect(region).not.toBe("");
    expect(region).toContain("transition_status"); // zero-hit guard
    expect(region).toMatch(/\breport|\bprint|\bsurface|\bsay\b|\bstate\b/i);
    expect(region).toMatch(/\breason\b/i);
    expect(region).not.toMatch(/\bsilent(ly)?\b/i);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-575.6 / .7 — the end-to-end arms, and AC-STE-575.8 — the mutation
// ---------------------------------------------------------------------------

/** The status today's unconditional post-create step leaves behind. */
const UNCONDITIONAL_RESULT = roleToStatus(THREE_LANE, "in_review"); // "In Review"

/** The ticket is observed already finished. */
const OBSERVED = roleToStatus(THREE_LANE, "done"); // "Done"

/** Apply a decider and return the tracker status the ticket ends up in. */
function resultingStatus(decider: Decider): string {
  const d = decider(OBSERVED, THREE_LANE);
  return d.action === "skip" ? OBSERVED : UNCONDITIONAL_RESULT;
}

/** AC.6's arm, parameterized on the decider so the mutant can run it too. */
function arm6(decider: Decider): string {
  return routeWithTolerance({
    observedStatus: resultingStatus(decider),
    expectedRole: "done",
    config: THREE_LANE,
    providerMode: "tracker",
    isTty: false,
    frId: "STE-575",
  }).kind;
}

const PLAN_STATE: PlanTaskState = {
  totalTasks: 3,
  uncheckedTasks: 1,
  planStatus: "active",
};

const STATUS_MAPPING = {
  in_progress: THREE_LANE.roles.in_progress,
  done: THREE_LANE.roles.done,
};

/** AC.7's arm, likewise parameterized. */
function arm7(decider: Decider): boolean {
  return activeTicketDriftPasses(
    { status: resultingStatus(decider), assignee: "operator" },
    PLAN_STATE,
    STATUS_MAPPING,
    "operator",
  );
}

/** The pre-change behaviour: transition unconditionally, no reason at all. */
const UNCONDITIONAL_DECIDER: Decider = () => ({ action: "transition", reason: "" });

describe("AC-STE-575.6 — gate routing passes after the decision", () => {
  test("the counterfactual is real: the unconditional result is genuine drift", () => {
    // Falsifiability floor. If this were already `pass`, the arm below would
    // prove nothing.
    expect(UNCONDITIONAL_RESULT).not.toBe(OBSERVED);
    expect(arm6(UNCONDITIONAL_DECIDER)).toBe("fail-genuine-drift");
  });

  test("post-decision status routes to `pass` against the done role", () => {
    expect(arm6(decide)).toBe("pass");
  });
});

describe("AC-STE-575.7 — active-ticket drift predicate after the decision", () => {
  test("the counterfactual is real: the unconditional result fails the predicate", () => {
    expect(arm7(UNCONDITIONAL_DECIDER)).toBe(false);
  });

  test("post-decision status passes the predicate", () => {
    expect(arm7(decide)).toBe(true);
  });
});

describe("AC-STE-575.8 — mutation arm: forcing `transition` reds both arms", () => {
  test("the mutant decider genuinely differs from the subject", () => {
    // Zero-hit guard on the mutation itself: if the subject already returned
    // `transition` here, the mutation would be a no-op and the arms below would
    // be asserting nothing.
    expect(resultingStatus(decide)).not.toBe(resultingStatus(UNCONDITIONAL_DECIDER));
  });

  test("AC.6 flips from pass to fail-genuine-drift under the mutation", () => {
    expect(arm6(decide)).toBe("pass");
    expect(arm6(UNCONDITIONAL_DECIDER)).toBe("fail-genuine-drift");
    expect(arm6(UNCONDITIONAL_DECIDER)).not.toBe(arm6(decide));
  });

  test("AC.7 flips from true to false under the mutation", () => {
    expect(arm7(decide)).toBe(true);
    expect(arm7(UNCONDITIONAL_DECIDER)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-575.9 — the three surfaces are amended together
// ---------------------------------------------------------------------------

/**
 * Body of the section whose heading matches `heading`, up to the next `##`.
 * Returns `""` when the heading is absent — callers assert non-empty, so a
 * renamed heading reds loudly instead of silently passing an empty region.
 */
function section(body: string, heading: RegExp): string {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => heading.test(l));
  if (start === -1) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s/.test(l));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

/** The `pr --> trk` edge of the workflow diagram, whole source line. */
function prTrackerEdge(body: string): string {
  const m = body.match(/^\s*pr\s*-->\|[^\n]*\|\s*trk\s*$/m);
  return m ? m[0] : "";
}

/**
 * The forward-only condition, as two clauses that must land TOGETHER.
 *
 * Checking them independently over a whole section is not enough: the Draft
 * section already says "neither is skipped, reordered, or duplicated" about an
 * unrelated matter, so a section-wide `IS_CONDITIONAL` is satisfied today by
 * prose that has nothing to do with the done lane. The predicate therefore asks
 * for one PARAGRAPH carrying both — naming the done lane and making the
 * transition conditional in the same breath, which is what a reader needs.
 */
const NAMES_DONE = /\bdone\b/i;
const IS_CONDITIONAL = /\bskip|\bunless\b|\bonly if\b|\bnot issued\b|forward[- ]only/i;

/** Blank-line-separated blocks of a region. A one-line region is one block. */
function paragraphs(region: string): string[] {
  return region.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
}

/** Does some single paragraph of this region carry BOTH clauses? */
function carriesForwardOnly(region: string): boolean {
  return paragraphs(region).some((p) => NAMES_DONE.test(p) && IS_CONDITIONAL.test(p));
}

describe("AC-STE-575.9 — every surface describing the post-create sequence", () => {
  const surfaces: Array<{ name: string; region: () => string; anchor: string }> = [
    {
      name: "skills/pr/SKILL.md § Tracker Mode Probe",
      region: () => section(read("skills/pr/SKILL.md"), /^##\s+Tracker Mode Probe\b/),
      anchor: "transition_status",
    },
    {
      name: "docs/pr-tracker-mode.md § Post-create",
      region: () => section(read("docs/pr-tracker-mode.md"), /^##\s+Post-create\b/),
      anchor: "transition_status",
    },
    {
      name: "docs/pr-tracker-mode.md § Draft pull requests (rationale)",
      region: () =>
        section(read("docs/pr-tracker-mode.md"), /^##\s+Draft pull requests\b/),
      anchor: "in_review",
    },
    {
      name: "docs/workflow-overview.md — the pr --> trk diagram edge",
      region: () => prTrackerEdge(read("docs/workflow-overview.md")),
      anchor: "in_review",
    },
  ];

  for (const surface of surfaces) {
    describe(surface.name, () => {
      test("the region is extractable and carries its anchor", () => {
        // Zero-hit guard: without this, a renamed heading or a reshaped diagram
        // edge would hand the clauses below an empty string to not-match.
        const region = surface.region();
        expect(region.trim().length).toBeGreaterThan(0);
        expect(region).toContain(surface.anchor);
      });

      test("carries the forward-only condition — done lane + conditionality, together", () => {
        expect(carriesForwardOnly(surface.region())).toBe(true);
      });
    });
  }

  test("the predicate can fail — a region stripped of the wording is rejected", () => {
    // Mutation guard on the checker itself. Every surface must still red when
    // the forward-only wording is removed, or the pins above are decorative.
    for (const surface of surfaces) {
      const stripped = surface
        .region()
        .replace(new RegExp(NAMES_DONE.source, "gi"), "x")
        .replace(new RegExp(IS_CONDITIONAL.source, "gi"), "x");
      expect(stripped.trim().length).toBeGreaterThan(0); // the strip left something
      expect(carriesForwardOnly(stripped)).toBe(false);
    }
  });

  test("the predicate is a conjunction — either clause alone is rejected", () => {
    expect(carriesForwardOnly("the ticket is already done")).toBe(false);
    expect(carriesForwardOnly("skip the call unless asked")).toBe(false);
    expect(carriesForwardOnly("skip the transition when the ticket is done")).toBe(true);
  });

  test("the conjunction must land in ONE paragraph, not merely somewhere in the section", () => {
    const split = "the ticket may already be done\n\nseparately: nothing is skipped here";
    expect(split).toMatch(NAMES_DONE);
    expect(split).toMatch(IS_CONDITIONAL);
    expect(carriesForwardOnly(split)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// AC-STE-575.10 — the MCP call budget is unchanged at two
// ---------------------------------------------------------------------------

describe("AC-STE-575.10 — MCP call budget stays at two", () => {
  const budget = () =>
    section(read("docs/pr-tracker-mode.md"), /^##\s+MCP call budget\b/);

  /** Does this budget text still declare exactly two calls? */
  function declaresTwo(text: string): boolean {
    const numbered = text.split("\n").filter((l) => /^\d+\.\s/.test(l));
    return /at most \*\*2\*\*/.test(text) && numbered.length === 2;
  }

  test("the budget section is extractable", () => {
    expect(budget().trim().length).toBeGreaterThan(0);
  });

  test("the shipped budget declares exactly two calls", () => {
    expect(declaresTwo(budget())).toBe(true);
  });

  test("the budget check can fail — raising the stated number reds it", () => {
    // `mutate` throws when the pattern matched nothing, so a checker watching a
    // phrase that no longer exists cannot pass as a green pin.
    expect(declaresTwo(mutate(budget(), /at most \*\*2\*\*/, "at most **3**"))).toBe(
      false,
    );
  });

  test("the decision is documented as costing no additional MCP call", () => {
    // The observed status is already read before any write, so the forward-only
    // decision is free. The docs must say so, or a later reader will assume the
    // read is new and revise the budget upward.
    const body = read("docs/pr-tracker-mode.md");
    const region = `${budget()}\n${section(body, /^##\s+Post-create\b/)}`;
    expect(region).toMatch(
      /no additional (MCP )?call|already read|no extra (MCP )?call|costs? no/i,
    );
  });
});

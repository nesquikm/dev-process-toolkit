// M129 STE-494 — the run's merge policy can be TIGHTENED conversationally and
// never loosened.
//
// WHAT IS BROKEN, measured on this tree at authoring time (2026-08-17, v2.67.1).
// `adapters/_shared/src/orchestration_config.ts` reads `merge_policy` from the
// `## Orchestration` block of CLAUDE.md and nowhere else, so the operator
// sentence "don't merge anything for the rest of this run" is a statement the
// orchestrator has no representation for. The measurements:
//
//   * `grep -rln "ratchet" skills/ docs/ adapters/` → ZERO files. There is no
//     transition check of any kind, tightening or otherwise.
//   * `ls adapters/_shared/src/merge_policy*` → no matches. The module this FR
//     specifies does not exist.
//   * `skills/deliver/SKILL.md:111` and `docs/deliver-reference.md:123` both
//     state that the ONLY enabling act for `auto` is the operator writing
//     `merge_policy: auto` into the config. That guarantee (AC-STE-463.3,
//     "`auto` is never inferred") is what makes a naive conversational override
//     unshippable, and what the ratchet exists to preserve.
//
// TEST STRATEGY, and why no half of it is a tautology.
//
//   * MODULE PINS (Tier 1). The transition matrix, the loosening guards, and the
//     refusal shape live in `adapters/_shared/src/merge_policy_ratchet.ts` and
//     are exercised as CODE. Prose is pinned only as the second half of a pair
//     whose first half is behavioural.
//   * THE VALUE SET IS SOURCED, NEVER RETYPED. `MERGE_POLICIES` in
//     `orchestration_config.ts` is the shared authority (STE-463/STE-464). This
//     file imports it statically and drives the FULL 3×3 matrix off it, so a
//     fourth policy value cannot be added on one side only — and the ratchet
//     module is pinned to import it rather than declare a second copy (the
//     STE-485 "retyped literal keeps reading green" lesson).
//   * THE FULL 3×3 MATRIX (AC.3). All NINE ordered pairs are classified
//     explicitly: three tightening (accepted), three identity (refused as
//     no-ops), three loosening (refused). The matrix's own size is asserted
//     against `MERGE_POLICIES.length ** 2`, so a pair cannot quietly go
//     unclassified.
//   * DROP-ONE MUTATION OVER EVERY LOOSENING GUARD (AC.5). `LOOSENING_GUARDS`
//     is an exported list and `classifyTransition` / `assertRatchet` accept a
//     guard-list override, so each guard is removed in turn and its own pair's
//     verdict must flip while its siblings stay refused. A guard that is inert,
//     or shadowed by a sibling, fails here. Per the M126 lesson, every drop is
//     asserted to have CHANGED the list before it is scored — a mutation that
//     never applied reads as a pass.
//   * TWO LAYERS, DELIBERATELY (AC.4 vs AC.5). `assertRatchet` is the pure
//     guard-driven pair check; `applyOverride` is the public entry point and
//     enforces the auto-target rule UNCONDITIONALLY, ahead of and independent of
//     the guards. That is why `assertRatchet("offer","auto",{guards:[]})` may
//     pass (the mutation flipped it) while `applyOverride(...,{guards:[]})` must
//     still refuse: AC.4's safety property survives the total loss of the guard
//     set, which is exactly the property STE-463 AC.3 needs.
//   * ISOLATION LEGS EVERYWHERE. "Nothing can produce `auto`" is satisfied
//     vacuously by a ratchet that refuses everything, so every negative pin is
//     paired with the positive one: the three tightening transitions are
//     genuinely ACCEPTED, and the override genuinely CHANGES the run's effective
//     policy and its post-PR routing.
//   * AC.6 IS A REAL ROUND TRIP, NOT A GREP. A temp CLAUDE.md is written, the
//     run policy is read from it, the override is applied, and the file's BYTES
//     are compared before and after — plus a fresh re-read that must still
//     return the configured value.
//
// DELIBERATE OMISSION — the global probe count. This FR registers `/gate-check`
// probe #79; STE-493 registers #78 in the SAME sweep (M129 plan, Risks table:
// "Land both probe registrations in one sweep rather than two, so the count-pin
// update happens once"). A `77 → 79` assertion here would be wrong the moment it
// landed alone, so this file pins ROW #79 by identity and asserts NO aggregate
// count. The aggregate pins (README's "numbered `/gate-check` probes" line, in
// `tests/gate-check-public-surface-count-drift.test.ts`) move 77 → 79 once,
// jointly with STE-493.
//
// HARD BUDGETS, measured at authoring time:
//   * `skills/` tree: 246 / 246 STE-N tokens — ZERO headroom. New SKILL prose
//     must cite by mechanism, never by ticket id.
//   * `skills/gate-check/SKILL.md`: 345 lines of a 358 cap — 13 free, and rows
//     #78 and #79 both have to fit, one line each.
//   * `skills/deliver/SKILL.md`: 111 lines of a 358 cap.
// This file lives under `tests/`, which carries neither budget.

import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  MERGE_POLICIES,
  type MergePolicy,
} from "../adapters/_shared/src/orchestration_config";

// ===========================================================================
// Paths.
// ===========================================================================

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const SKILLS_DIR = join(PLUGIN_ROOT, "skills");
const SHARED_SRC = join(PLUGIN_ROOT, "adapters", "_shared", "src");

const read = (p: string): string => readFileSync(p, "utf-8");
const skillPath = (name: string): string => join(SKILLS_DIR, name, "SKILL.md");
const skillBody = (name: string): string => read(skillPath(name));

/**
 * The FR under test, resolved with the ARCHIVE FALLBACK. `/implement` Phase 4
 * `git mv`s the FR into `specs/frs/archive/` at milestone close, and a meta-test
 * that only knows the active path goes red at the archive commit — the recurring
 * failure recorded in the M100/M126 notes.
 */
function frPath(): string {
  const active = join(REPO_ROOT, "specs", "frs", "STE-494.md");
  if (existsSync(active)) return active;
  const archived = join(REPO_ROOT, "specs", "frs", "archive", "STE-494.md");
  if (existsSync(archived)) return archived;
  throw new Error(
    "STE-494.md found in neither specs/frs/ nor specs/frs/archive/",
  );
}

// ===========================================================================
// The modules under test, imported LAZILY.
//
// A top-level static import of a not-yet-written module aborts the whole file,
// which would collapse the independent reds into one load error and hide which
// ACs are actually unmet. `orchestration_config` IS imported statically above —
// it is shipped, and this file's matrix is derived from it.
// ===========================================================================

const RATCHET_MODULE = "../adapters/_shared/src/merge_policy_ratchet";
const PROBE_MODULE = "../adapters/_shared/src/merge_policy_override_ratchet";

const RATCHET_MODULE_FILE = join(SHARED_SRC, "merge_policy_ratchet.ts");
const PROBE_MODULE_FILE = join(SHARED_SRC, "merge_policy_override_ratchet.ts");

type TransitionVerdict = "tightening" | "identity" | "loosening";

interface LooseningGuard {
  /** Stable id — the drop-one mutation keys on it. */
  readonly id: string;
  readonly from: MergePolicy;
  readonly to: MergePolicy;
  /** The operator-facing rendering the probe demands in prose. */
  readonly prosePhrase: string;
  readonly reason: string;
  matches(from: MergePolicy, to: MergePolicy): boolean;
}

interface PolicyOverride {
  readonly from: MergePolicy;
  readonly requested: MergePolicy;
  /** The operator's own words, or "" when built programmatically. */
  readonly text: string;
  /** Rendered back to the operator before it takes effect. */
  readonly restatement: string;
  /** False until `confirmOverride` has put the restatement on the record. */
  readonly active: boolean;
}

interface RunMergePolicy {
  /** What CLAUDE.md said. Never mutated by an override. */
  readonly configured: MergePolicy;
  /** What the rest of the run actually uses. */
  readonly effective: MergePolicy;
  readonly override: PolicyOverride | null;
}

type GuardOptions = { guards?: readonly LooseningGuard[] };

interface RatchetModule {
  LOOSENING_GUARDS: readonly LooseningGuard[];
  TIGHTENING_TRANSITIONS: readonly (readonly [MergePolicy, MergePolicy])[];
  FORBIDDEN_OVERRIDE_TARGET: MergePolicy;
  ENABLING_ACT_PHRASE: string;
  OVERRIDE_ANCHOR: string;
  classifyTransition(
    from: MergePolicy,
    to: MergePolicy,
    options?: GuardOptions,
  ): TransitionVerdict;
  isTightening(
    from: MergePolicy,
    to: MergePolicy,
    options?: GuardOptions,
  ): boolean;
  assertRatchet(
    from: MergePolicy,
    to: MergePolicy,
    options?: GuardOptions,
  ): void;
  isOverrideStatement(text: string): boolean;
  overrideFromStatement(text: string, from: MergePolicy): PolicyOverride;
  proposeOverride(from: MergePolicy, requested: MergePolicy): PolicyOverride;
  confirmOverride(o: PolicyOverride): PolicyOverride;
  runMergePolicy(projectRoot: string): RunMergePolicy;
  applyOverride(
    run: RunMergePolicy,
    o: PolicyOverride,
    options?: GuardOptions,
  ): RunMergePolicy;
  postPrAction(run: RunMergePolicy): "ask" | "merge" | "stop";
}

async function ratchet(): Promise<RatchetModule> {
  return (await import(RATCHET_MODULE)) as unknown as RatchetModule;
}

interface ProbeViolation {
  file: string;
  line: number;
  reason: string;
  note: string;
  message: string;
  severity: "error" | "warning";
}

interface ProbeModule {
  PROBE_ID: string;
  requiredRatchetPhrases(): string[];
  runMergePolicyOverrideRatchetProbe(
    projectRoot: string,
  ): Promise<{ violations: ProbeViolation[] }>;
}

async function probeModule(): Promise<ProbeModule> {
  return (await import(PROBE_MODULE)) as unknown as ProbeModule;
}

// ===========================================================================
// The contract, written in terms of the SHARED value set.
// ===========================================================================

const P = {
  offer: "offer" as MergePolicy,
  auto: "auto" as MergePolicy,
  never: "never" as MergePolicy,
};

const key = (from: MergePolicy, to: MergePolicy): string => `${from}->${to}`;

/**
 * AC-STE-494.3 — the FULL 3×3 matrix, every ordered pair classified.
 *
 * Tightening (the ONLY accepted transitions): offer→never, auto→offer,
 * auto→never. Identity transitions change nothing and are refused as no-ops —
 * which also keeps `auto→auto` from being an accepted transition whose output
 * is `auto`. Everything else loosens and is refused.
 */
const EXPECTED_VERDICTS: Record<string, TransitionVerdict> = {
  "offer->offer": "identity",
  "offer->auto": "loosening",
  "offer->never": "tightening",
  "auto->offer": "tightening",
  "auto->auto": "identity",
  "auto->never": "tightening",
  "never->offer": "loosening",
  "never->auto": "loosening",
  "never->never": "identity",
};

const pairsWith = (v: TransitionVerdict): [MergePolicy, MergePolicy][] =>
  Object.entries(EXPECTED_VERDICTS)
    .filter(([, verdict]) => verdict === v)
    .map(([k]) => k.split("->") as [MergePolicy, MergePolicy]);

const TIGHTENING_PAIRS = pairsWith("tightening");
const LOOSENING_PAIRS = pairsWith("loosening");
const IDENTITY_PAIRS = pairsWith("identity");

/**
 * One guard id per loosening pair. Each pair gets its OWN guard so each can be
 * dropped independently; a single predicate covering all three would be
 * mutation-verifiable only as a unit, which is what AC-STE-494.5's "every
 * loosening guard in it is mutation-verified" forbids.
 */
const EXPECTED_GUARD_IDS = [
  "offer_to_auto",
  "never_to_offer",
  "never_to_auto",
] as const;

/**
 * Operator statements that tighten, and the policy each must resolve to.
 * These are the AC.1 inputs: prose, not config edits.
 */
const TIGHTENING_STATEMENTS: { text: string; from: MergePolicy; to: MergePolicy }[] =
  [
    { text: "don't merge anything", from: P.auto, to: P.never },
    { text: "don't merge anything", from: P.offer, to: P.never },
    { text: "stop merging for the rest of this run", from: P.auto, to: P.never },
    { text: "ask me before every merge", from: P.auto, to: P.offer },
  ];

/**
 * AC-STE-494.4's adversarial battery. Every one of these is prose that WANTS
 * `auto`, phrased the way an operator (or a persuaded model) would phrase it.
 * None may produce `auto`, by any route.
 */
const AUTO_SEEKING_STATEMENTS = [
  "merge everything yourself from now on",
  "turn on auto-merge",
  "set merge_policy to auto for the rest of the run",
  "merge_policy: auto",
  "you can auto merge from here",
  "stop asking me about merges, just merge them",
  "I authorize auto for this run",
  "switch the merge policy to auto",
] as const;

/** Prose that is not an override statement at all — the detector's negative half. */
const NOT_AN_OVERRIDE = [
  "ship M129 at effort ultracode",
  "what does the merge policy say right now?",
  "",
] as const;

/** The probe slot this FR claims. #77 is the last shipped probe (M126). */
const NEW_PROBE_NUMBER = 79;
const PROBE_ID_EXPECTED = "merge_policy_override_ratchet";

/** Assert an NFR-10 canonical refusal, and hand the message back for more pins. */
function expectNfr10Refusal(fn: () => unknown, label: string): string {
  let raised: unknown = null;
  try {
    fn();
  } catch (e) {
    raised = e;
  }
  expect(raised, `${label}: nothing was refused`).not.toBeNull();
  const msg = String((raised as Error).message);
  expect(msg, `${label}: no Refusing: line`).toContain("Refusing:");
  expect(msg, `${label}: no Remedy: line`).toContain("Remedy:");
  expect(msg, `${label}: no Context: line`).toContain("Context:");
  return msg;
}

// ===========================================================================
// TRIPWIRES — written first; they are what stops a bad "fix".
// ===========================================================================

describe("TRIPWIRE — the budgets and authorities this FR's edits ride against", () => {
  const SKILL_LINE_CAP = 358;
  const SKILLS_STE_TOKEN_CEILING = 246;

  test(`skills/gate-check/SKILL.md stays within the NFR-1 line cap (${SKILL_LINE_CAP})`, () => {
    // 345 / 358 at authoring time. Probe rows #78 (STE-493) and #79 (this FR)
    // must each be ONE line, like every row above them.
    expect(skillBody("gate-check").split("\n").length).toBeLessThanOrEqual(
      SKILL_LINE_CAP,
    );
  });

  test(`skills/deliver/SKILL.md stays within the NFR-1 line cap (${SKILL_LINE_CAP})`, () => {
    expect(skillBody("deliver").split("\n").length).toBeLessThanOrEqual(
      SKILL_LINE_CAP,
    );
  });

  test(`the skills/ STE-token ceiling (${SKILLS_STE_TOKEN_CEILING}) is not breached`, () => {
    let count = 0;
    const walk = (d: string): void => {
      for (const name of readdirSync(d)) {
        const p = join(d, name);
        if (statSync(p).isDirectory()) {
          walk(p);
          continue;
        }
        if (!name.endsWith(".md")) continue;
        count += (read(p).match(/\b(STE|AC-STE)-\d+(?:\.\d+)?\b/g) ?? []).length;
      }
    };
    walk(SKILLS_DIR);
    expect(count).toBeLessThanOrEqual(SKILLS_STE_TOKEN_CEILING);
  });

  test("MERGE_POLICIES is still exactly offer|auto|never — the matrix is built on it", () => {
    // The 3×3 matrix below is only complete if the value set has three members.
    // A fourth value silently added upstream would leave pairs unclassified.
    expect([...MERGE_POLICIES].sort()).toEqual(["auto", "never", "offer"]);
    expect(Object.keys(EXPECTED_VERDICTS).length).toBe(MERGE_POLICIES.length ** 2);
  });

  test("the shipped `auto` guarantee this FR must not weaken is still on the surface", () => {
    // The whole reconciliation rests on these two sentences staying true. If
    // /deliver ever gained an inference path to `auto`, the ratchet would be
    // preserving a guarantee that no longer exists.
    expect(skillBody("deliver")).toContain(
      "no inference path may enable `auto`",
    );
    expect(read(join(PLUGIN_ROOT, "docs", "deliver-reference.md"))).toContain(
      "The only enabling act is the operator writing `merge_policy: auto` into the orchestration config themselves.",
    );
  });
});

// ===========================================================================
// AC-STE-494.1 — an operator statement restricts merging for the rest of the
// run, with no CLAUDE.md edit.
// ===========================================================================

describe("AC-STE-494.1 — a spoken restriction takes effect for the remainder of the run", () => {
  test("every tightening statement resolves to the policy it names", async () => {
    const { overrideFromStatement } = await ratchet();
    for (const { text, from, to } of TIGHTENING_STATEMENTS) {
      const o = overrideFromStatement(text, from);
      expect(o.requested, `"${text}" from ${from}`).toBe(to);
      expect(o.from, `"${text}"`).toBe(from);
      expect(o.text, `"${text}" loses the operator's words`).toContain(text);
    }
  });

  test("a confirmed override changes the run's EFFECTIVE policy", async () => {
    const { overrideFromStatement, confirmOverride, applyOverride } =
      await ratchet();
    const run: RunMergePolicy = {
      configured: P.auto,
      effective: P.auto,
      override: null,
    };
    const o = confirmOverride(overrideFromStatement("don't merge anything", P.auto));
    const after = applyOverride(run, o);
    expect(after.effective).toBe(P.never);
    expect(after.override).not.toBeNull();
  });

  test("the CONFIGURED value is untouched — the override is a run fact, not a config fact", async () => {
    const { overrideFromStatement, confirmOverride, applyOverride } =
      await ratchet();
    const run: RunMergePolicy = {
      configured: P.auto,
      effective: P.auto,
      override: null,
    };
    const o = confirmOverride(overrideFromStatement("don't merge anything", P.auto));
    expect(applyOverride(run, o).configured).toBe(P.auto);
  });

  test("the restriction reaches the decision it exists to change — post-PR routing", async () => {
    // Behavioural teeth. `auto` would have merged; after the override the same
    // run stops at the open PR, which is the operator's actual ask.
    const { overrideFromStatement, confirmOverride, applyOverride, postPrAction } =
      await ratchet();
    const run: RunMergePolicy = {
      configured: P.auto,
      effective: P.auto,
      override: null,
    };
    expect(postPrAction(run), "ISOLATION: the pre-override run would merge").toBe(
      "merge",
    );
    const o = confirmOverride(overrideFromStatement("don't merge anything", P.auto));
    expect(postPrAction(applyOverride(run, o))).toBe("stop");
  });

  test("postPrAction maps all three policies — none is a dead branch", async () => {
    const { postPrAction } = await ratchet();
    const expected: Record<MergePolicy, "ask" | "merge" | "stop"> = {
      offer: "ask",
      auto: "merge",
      never: "stop",
    };
    for (const p of MERGE_POLICIES) {
      expect(
        postPrAction({ configured: p, effective: p, override: null }),
        `policy ${p}`,
      ).toBe(expected[p]);
    }
  });

  test("the override survives further milestones — it is carried, not re-derived", async () => {
    // "For the remainder of the run": the effective policy of the run value is
    // what later stages read, and re-reading it does not resurrect the config.
    const { overrideFromStatement, confirmOverride, applyOverride, postPrAction } =
      await ratchet();
    let run: RunMergePolicy = {
      configured: P.auto,
      effective: P.auto,
      override: null,
    };
    run = applyOverride(
      run,
      confirmOverride(overrideFromStatement("don't merge anything", P.auto)),
    );
    for (let milestone = 0; milestone < 3; milestone++) {
      expect(run.effective, `milestone ${milestone}`).toBe(P.never);
      expect(postPrAction(run), `milestone ${milestone}`).toBe("stop");
    }
  });

  test("successive overrides keep ratcheting one way only", async () => {
    const { proposeOverride, confirmOverride, applyOverride } = await ratchet();
    let run: RunMergePolicy = {
      configured: P.auto,
      effective: P.auto,
      override: null,
    };
    run = applyOverride(run, confirmOverride(proposeOverride(P.auto, P.offer)));
    expect(run.effective).toBe(P.offer);
    run = applyOverride(run, confirmOverride(proposeOverride(P.offer, P.never)));
    expect(run.effective).toBe(P.never);
    // …and back is refused, from the state the run is actually in.
    expectNfr10Refusal(
      () => applyOverride(run, confirmOverride(proposeOverride(P.never, P.offer))),
      "never → offer after two tightenings",
    );
  });

  test("an override whose `from` disagrees with the run's effective policy refuses", async () => {
    // Anti-drift: an override minted against a stale reading must not be
    // applied to a run that has since tightened further.
    const { proposeOverride, confirmOverride, applyOverride } = await ratchet();
    const stale = confirmOverride(proposeOverride(P.auto, P.offer));
    const run: RunMergePolicy = {
      configured: P.auto,
      effective: P.never,
      override: null,
    };
    expectNfr10Refusal(() => applyOverride(run, stale), "stale override");
  });

  test("prose that is not an override is not detected as one", async () => {
    const { isOverrideStatement } = await ratchet();
    for (const { text } of TIGHTENING_STATEMENTS) {
      expect(isOverrideStatement(text), `"${text}"`).toBe(true);
    }
    for (const text of NOT_AN_OVERRIDE) {
      expect(isOverrideStatement(text), `"${text}"`).toBe(false);
    }
  });

  test("minting an override from non-override prose refuses in NFR-10 shape", async () => {
    const { overrideFromStatement } = await ratchet();
    expectNfr10Refusal(
      () => overrideFromStatement(NOT_AN_OVERRIDE[0], P.offer),
      "non-override prose",
    );
  });

  test("skills/deliver/SKILL.md states the spoken restriction takes effect run-wide", () => {
    const body = skillBody("deliver").toLowerCase();
    expect(body).toContain("merge-policy override");
    expect(
      /rest of (this|the) run|remainder of (this|the) run/.test(body),
      "deliver/SKILL.md never states the override's scope in time",
    ).toBe(true);
  });
});

// ===========================================================================
// AC-STE-494.2 — restated back once, so the scope is on the record.
// ===========================================================================

describe("AC-STE-494.2 — the override is restated before it is in effect", () => {
  test("a proposed override is NOT active", async () => {
    const { proposeOverride } = await ratchet();
    expect(proposeOverride(P.auto, P.never).active).toBe(false);
  });

  test("an UNCONFIRMED override changes nothing when applied", async () => {
    const { proposeOverride, applyOverride } = await ratchet();
    const run: RunMergePolicy = {
      configured: P.auto,
      effective: P.auto,
      override: null,
    };
    const after = applyOverride(run, proposeOverride(P.auto, P.never));
    expect(after.effective).toBe(P.auto);
    expect(after.override).toBeNull();
  });

  test("NON-VACUITY: confirming the SAME override does change the run", async () => {
    // The A/B control. Without it, "unconfirmed changes nothing" would be
    // indistinguishable from an override mechanism that never works at all.
    const { proposeOverride, confirmOverride, applyOverride } = await ratchet();
    const run: RunMergePolicy = {
      configured: P.auto,
      effective: P.auto,
      override: null,
    };
    const confirmed = confirmOverride(proposeOverride(P.auto, P.never));
    expect(confirmed.active).toBe(true);
    expect(applyOverride(run, confirmed).effective).toBe(P.never);
  });

  test("the restatement names both policies and the scope in time", async () => {
    const { proposeOverride } = await ratchet();
    for (const [from, to] of TIGHTENING_PAIRS) {
      const { restatement } = proposeOverride(from, to);
      expect(restatement.trim().length, `${from}→${to}`).toBeGreaterThan(40);
      expect(restatement, `${from}→${to} omits the old policy`).toContain(from);
      expect(restatement, `${from}→${to} omits the new policy`).toContain(to);
      expect(restatement, `${from}→${to} omits its scope`).toMatch(
        /rest of (this|the) run/i,
      );
    }
  });

  test("the restatement says the override is not written to CLAUDE.md", async () => {
    // AC.6's half of the record: the operator learns, at restatement time, that
    // nothing was persisted.
    const { proposeOverride } = await ratchet();
    const { restatement } = proposeOverride(P.auto, P.never);
    expect(restatement).toContain("CLAUDE.md");
    expect(restatement).toMatch(/not (written|persisted)|never (written|persisted)/i);
  });

  test("an override built from prose carries the operator's own words back", async () => {
    const { overrideFromStatement } = await ratchet();
    for (const { text, from } of TIGHTENING_STATEMENTS) {
      expect(overrideFromStatement(text, from).restatement).toContain(text);
    }
  });

  test("ONCE: re-confirming an already-active override refuses", async () => {
    const { proposeOverride, confirmOverride } = await ratchet();
    const confirmed = confirmOverride(proposeOverride(P.auto, P.never));
    expectNfr10Refusal(() => confirmOverride(confirmed), "second confirmation");
  });

  test("confirmation preserves the requested policy and the restatement verbatim", async () => {
    const { proposeOverride, confirmOverride } = await ratchet();
    const proposed = proposeOverride(P.auto, P.offer);
    const confirmed = confirmOverride(proposed);
    expect(confirmed.requested).toBe(proposed.requested);
    expect(confirmed.from).toBe(proposed.from);
    expect(confirmed.restatement).toBe(proposed.restatement);
  });

  test("skills/deliver/SKILL.md states the restate-once rule", () => {
    const body = skillBody("deliver").toLowerCase();
    expect(body).toContain("restate");
    expect(
      /restate[sd]? .{0,80}(once|before it takes effect)|before it takes effect/.test(
        body,
      ),
      "deliver/SKILL.md never states that the override is restated before it takes effect",
    ).toBe(true);
  });
});

// ===========================================================================
// AC-STE-494.3 — the FULL 3×3 transition matrix.
// ===========================================================================

describe("AC-STE-494.3 — every one of the nine ordered pairs is classified", () => {
  test("the matrix under test covers every ordered pair of MERGE_POLICIES", () => {
    // Guards the guard: an unlisted pair would be silently untested.
    for (const from of MERGE_POLICIES) {
      for (const to of MERGE_POLICIES) {
        expect(
          EXPECTED_VERDICTS[key(from, to)],
          `pair ${from}→${to} is unclassified in this test file`,
        ).toBeDefined();
      }
    }
    expect(TIGHTENING_PAIRS.length).toBe(3);
    expect(LOOSENING_PAIRS.length).toBe(3);
    expect(IDENTITY_PAIRS.length).toBe(3);
  });

  test("classifyTransition agrees with the matrix on all nine pairs", async () => {
    const { classifyTransition } = await ratchet();
    for (const from of MERGE_POLICIES) {
      for (const to of MERGE_POLICIES) {
        expect(classifyTransition(from, to), `${from}→${to}`).toBe(
          EXPECTED_VERDICTS[key(from, to)],
        );
      }
    }
  });

  test("TIGHTENING_TRANSITIONS is exactly the three the AC names", async () => {
    const { TIGHTENING_TRANSITIONS } = await ratchet();
    expect(TIGHTENING_TRANSITIONS.map((t) => key(t[0], t[1])).sort()).toEqual(
      TIGHTENING_PAIRS.map(([f, t]) => key(f, t)).sort(),
    );
  });

  test("ISOLATION: the three tightening transitions are genuinely ACCEPTED", async () => {
    // Without this leg, a ratchet that refuses everything would satisfy every
    // negative pin in this file.
    const { assertRatchet, isTightening } = await ratchet();
    for (const [from, to] of TIGHTENING_PAIRS) {
      expect(() => assertRatchet(from, to), `${from}→${to}`).not.toThrow();
      expect(isTightening(from, to), `${from}→${to}`).toBe(true);
    }
  });

  test("every loosening transition is REFUSED, in NFR-10 shape, naming both ends", async () => {
    const { assertRatchet } = await ratchet();
    for (const [from, to] of LOOSENING_PAIRS) {
      const msg = expectNfr10Refusal(
        () => assertRatchet(from, to),
        `${from}→${to}`,
      );
      expect(msg, `${from}→${to} refusal omits the source policy`).toContain(from);
      expect(msg, `${from}→${to} refusal omits the target policy`).toContain(to);
      expect(msg).toMatch(/loosen/i);
    }
  });

  test("every identity transition is REFUSED as a no-op, distinctly from loosening", async () => {
    const { assertRatchet } = await ratchet();
    for (const [from, to] of IDENTITY_PAIRS) {
      const msg = expectNfr10Refusal(
        () => assertRatchet(from, to),
        `${from}→${to}`,
      );
      // A no-op refusal that read "loosening" would mislabel the operator's ask
      // and — for auto→auto — would file an accepted-looking auto transition.
      expect(msg, `${from}→${to} was reported as a loosening`).toMatch(
        /already|no-op|unchanged/i,
      );
    }
  });

  test("isTightening is false for every non-tightening pair", async () => {
    const { isTightening } = await ratchet();
    for (const [from, to] of [...LOOSENING_PAIRS, ...IDENTITY_PAIRS]) {
      expect(isTightening(from, to), `${from}→${to}`).toBe(false);
    }
  });

  test("applyOverride accepts exactly the tightening pairs and refuses the other six", async () => {
    // The matrix again, at the PUBLIC entry point rather than the predicate.
    const { proposeOverride, confirmOverride, applyOverride } = await ratchet();
    for (const from of MERGE_POLICIES) {
      for (const to of MERGE_POLICIES) {
        const run: RunMergePolicy = {
          configured: from,
          effective: from,
          override: null,
        };
        const verdict = EXPECTED_VERDICTS[key(from, to)];
        if (verdict === "tightening") {
          const o = confirmOverride(proposeOverride(from, to));
          expect(applyOverride(run, o).effective, `${from}→${to}`).toBe(to);
          continue;
        }
        expectNfr10Refusal(() => {
          const o = confirmOverride(proposeOverride(from, to));
          return applyOverride(run, o);
        }, `${from}→${to} at applyOverride`);
      }
    }
  });
});

// ===========================================================================
// AC-STE-494.4 — nothing can produce `auto`.
//
// The load-bearing safety property. STE-463 AC.3 says `auto` is never inferred;
// this AC says the conversational channel does not become an inference path.
// ===========================================================================

describe("AC-STE-494.4 — no input to the ratchet ever yields `auto`", () => {
  test("`auto` is declared the forbidden override target", async () => {
    const { FORBIDDEN_OVERRIDE_TARGET } = await ratchet();
    expect(FORBIDDEN_OVERRIDE_TARGET).toBe(P.auto);
    expect([...MERGE_POLICIES]).toContain(FORBIDDEN_OVERRIDE_TARGET);
  });

  test("no tightening transition has `auto` as its target — by construction", async () => {
    const { TIGHTENING_TRANSITIONS } = await ratchet();
    expect(TIGHTENING_TRANSITIONS.length).toBeGreaterThan(0);
    for (const [from, to] of TIGHTENING_TRANSITIONS) {
      expect(to, `${from}→${to} targets auto`).not.toBe(P.auto);
    }
  });

  test("EXHAUSTIVE: no pair in the whole matrix yields an effective `auto` it did not start with", async () => {
    const { proposeOverride, confirmOverride, applyOverride } = await ratchet();
    for (const from of MERGE_POLICIES) {
      for (const to of MERGE_POLICIES) {
        const run: RunMergePolicy = {
          configured: P.never,
          effective: from,
          override: null,
        };
        let after: RunMergePolicy | null = null;
        try {
          after = applyOverride(run, confirmOverride(proposeOverride(from, to)));
        } catch {
          after = null;
        }
        if (after === null) continue;
        expect(after.effective, `${from}→${to} produced auto`).not.toBe(P.auto);
      }
    }
  });

  test("EXHAUSTIVE: not even with EVERY loosening guard dropped", async () => {
    // The layering pin. `assertRatchet` is guard-driven and the drop-one
    // mutation below flips it; `applyOverride` enforces the auto-target rule
    // unconditionally, so AC.4 survives the total loss of the guard set.
    const { proposeOverride, confirmOverride, applyOverride } = await ratchet();
    for (const from of MERGE_POLICIES) {
      const run: RunMergePolicy = {
        configured: P.never,
        effective: from,
        override: null,
      };
      expectNfr10Refusal(() => {
        const o = confirmOverride(proposeOverride(from, P.auto));
        return applyOverride(run, o, { guards: [] });
      }, `${from}→auto with all guards dropped`);
    }
  });

  test("the auto-target refusal names the only real enabling act", async () => {
    const { proposeOverride, confirmOverride, applyOverride, ENABLING_ACT_PHRASE } =
      await ratchet();
    const run: RunMergePolicy = {
      configured: P.offer,
      effective: P.offer,
      override: null,
    };
    const msg = expectNfr10Refusal(() => {
      const o = confirmOverride(proposeOverride(P.offer, P.auto));
      return applyOverride(run, o, { guards: [] });
    }, "offer→auto");
    expect(ENABLING_ACT_PHRASE).toContain("auto");
    expect(msg, "the refusal never tells the operator how to really enable auto").toContain(
      ENABLING_ACT_PHRASE,
    );
  });

  test("no auto-seeking PROSE produces an override targeting auto", async () => {
    const { isOverrideStatement, overrideFromStatement } = await ratchet();
    for (const text of AUTO_SEEKING_STATEMENTS) {
      for (const from of MERGE_POLICIES) {
        let produced: PolicyOverride | null = null;
        try {
          produced = overrideFromStatement(text, from);
        } catch {
          produced = null;
        }
        if (produced === null) continue;
        expect(
          produced.requested,
          `"${text}" from ${from} minted an auto override`,
        ).not.toBe(P.auto);
      }
      // Whatever the detector says, the statement may never mint auto above.
      expect(typeof isOverrideStatement(text)).toBe("boolean");
    }
  });

  test("EXHAUSTIVE PROSE: no statement × policy pair reaches auto, even through the run", async () => {
    const { overrideFromStatement, confirmOverride, applyOverride } = await ratchet();
    const corpus = [
      ...AUTO_SEEKING_STATEMENTS,
      ...TIGHTENING_STATEMENTS.map((s) => s.text),
      ...NOT_AN_OVERRIDE,
    ];
    for (const text of corpus) {
      for (const from of MERGE_POLICIES) {
        const run: RunMergePolicy = {
          configured: from,
          effective: from,
          override: null,
        };
        let after: RunMergePolicy | null = null;
        try {
          after = applyOverride(
            run,
            confirmOverride(overrideFromStatement(text, from)),
          );
        } catch {
          after = null;
        }
        if (after === null) continue;
        expect(after.effective, `"${text}" from ${from}`).not.toBe(P.auto);
      }
    }
  });

  test("ISOLATION: the same corpus DOES move a run that should move", async () => {
    // Without this, "nothing ever reaches auto" would be satisfied by prose
    // handling that rejects every input it is ever given.
    const { overrideFromStatement, confirmOverride, applyOverride } = await ratchet();
    let moved = 0;
    for (const { text, from, to } of TIGHTENING_STATEMENTS) {
      const run: RunMergePolicy = {
        configured: from,
        effective: from,
        override: null,
      };
      const after = applyOverride(
        run,
        confirmOverride(overrideFromStatement(text, from)),
      );
      expect(after.effective, `"${text}" from ${from}`).toBe(to);
      moved++;
    }
    expect(moved).toBe(TIGHTENING_STATEMENTS.length);
  });

  test("a run only ever reaches `auto` by having been CONFIGURED that way", async () => {
    const { runMergePolicy } = await ratchet();
    const fx = makeProject("merge_policy: auto");
    try {
      const run = runMergePolicy(fx.root);
      expect(run.configured).toBe(P.auto);
      expect(run.effective).toBe(P.auto);
      expect(run.override).toBeNull();
    } finally {
      fx.cleanup();
    }
  });

  test("an absent config yields the shipped default `offer`, never `auto`", async () => {
    const { runMergePolicy } = await ratchet();
    const fx = makeProject(null);
    try {
      expect(runMergePolicy(fx.root).effective).toBe(P.offer);
    } finally {
      fx.cleanup();
    }
  });
});

// ===========================================================================
// AC-STE-494.5 — a shared module, an NFR-10 refusal, mutation-verified guards.
// ===========================================================================

describe("AC-STE-494.5 — the module is shared and sources its value set", () => {
  test("the module exists at its pinned path under adapters/_shared/src", () => {
    expect(existsSync(RATCHET_MODULE_FILE)).toBe(true);
  });

  test("it IMPORTS MERGE_POLICIES rather than retyping the closed set", async () => {
    // The STE-485 lesson: a retyped literal keeps reading green after the
    // shared authority drifts. `orchestration_config.ts` is the authority.
    const src = read(RATCHET_MODULE_FILE);
    expect(src).toMatch(
      /import\s*(?:type\s*)?\{[^}]*MERGE_POLICIES[^}]*\}\s*from\s*"\.\/orchestration_config"/,
    );
    expect(
      /export const MERGE_POLICIES/.test(src),
      "the ratchet module declares a SECOND copy of the closed set",
    ).toBe(false);
  });

  test("the refusal is a named error carrying the NFR-10 canonical shape", async () => {
    const { assertRatchet } = await ratchet();
    let raised: unknown = null;
    try {
      assertRatchet(P.never, P.auto);
    } catch (e) {
      raised = e;
    }
    expect(raised).not.toBeNull();
    const err = raised as Error;
    expect(err.name).toMatch(/MergePolicy/);
    for (const part of ["Refusing:", "Remedy:", "Context:"]) {
      expect(err.message, `refusal omits ${part}`).toContain(part);
    }
    // Mirrors MalformedOrchestrationConfigError: Context: carries mode= and the
    // machine-readable facts a caller renders verbatim.
    expect(err.message).toMatch(/Context:.*mode=/);
  });

  test("NON-VACUITY: the same shape assertion fails on a bare Error", () => {
    // Proves the pin above is about a shape something can lack.
    const bare = new Error("nope");
    expect(bare.message).not.toContain("Refusing:");
  });
});

describe("AC-STE-494.5 — the loosening guard set is the one the matrix names", () => {
  test("LOOSENING_GUARDS carries exactly one guard per loosening pair", async () => {
    const { LOOSENING_GUARDS } = await ratchet();
    expect(LOOSENING_GUARDS.map((g) => g.id).sort()).toEqual(
      [...EXPECTED_GUARD_IDS].sort(),
    );
    expect(LOOSENING_GUARDS.map((g) => key(g.from, g.to)).sort()).toEqual(
      LOOSENING_PAIRS.map(([f, t]) => key(f, t)).sort(),
    );
  });

  test("every guard names a reason and a distinct operator-facing phrase", async () => {
    const { LOOSENING_GUARDS } = await ratchet();
    for (const g of LOOSENING_GUARDS) {
      expect(g.reason.trim().length, `guard ${g.id}`).toBeGreaterThan(10);
      expect(g.prosePhrase.trim().length, `guard ${g.id}`).toBeGreaterThan(0);
      expect(g.prosePhrase, `guard ${g.id} phrase omits its source`).toContain(g.from);
      expect(g.prosePhrase, `guard ${g.id} phrase omits its target`).toContain(g.to);
    }
    expect(new Set(LOOSENING_GUARDS.map((g) => g.prosePhrase)).size).toBe(
      LOOSENING_GUARDS.length,
    );
  });

  test("each guard matches its OWN pair and no other — isolation", async () => {
    // If two guards caught the same pair, dropping either would leave the other
    // standing, the verdict would not flip, and the mutation below would prove
    // nothing about the dropped guard.
    const { LOOSENING_GUARDS } = await ratchet();
    for (const g of LOOSENING_GUARDS) {
      const hits = LOOSENING_GUARDS.filter((x) => x.matches(g.from, g.to)).map(
        (x) => x.id,
      );
      expect(hits, `${g.id}: pair is not isolated`).toEqual([g.id]);
    }
  });

  test("no guard matches a tightening or identity pair", async () => {
    const { LOOSENING_GUARDS } = await ratchet();
    for (const [from, to] of [...TIGHTENING_PAIRS, ...IDENTITY_PAIRS]) {
      const hits = LOOSENING_GUARDS.filter((g) => g.matches(from, to)).map(
        (g) => g.id,
      );
      expect(hits, `${from}→${to} tripped a loosening guard`).toEqual([]);
    }
  });
});

describe("AC-STE-494.5 — DROP-ONE MUTATION: every loosening guard is load-bearing", () => {
  test("dropping a guard flips ITS pair's verdict — every guard, one at a time", async () => {
    const { LOOSENING_GUARDS, classifyTransition } = await ratchet();
    expect(LOOSENING_GUARDS.length).toBe(LOOSENING_PAIRS.length);
    for (const g of LOOSENING_GUARDS) {
      const others = LOOSENING_GUARDS.filter((x) => x.id !== g.id);
      // MUTATION APPLIED? A mutation that silently never applied reads as a
      // pass, so the drop is measured before it is scored.
      expect(others.length, `${g.id}: drop did not apply`).toBe(
        LOOSENING_GUARDS.length - 1,
      );
      expect(
        classifyTransition(g.from, g.to),
        `${g.id}: its pair is not loosening with the full set`,
      ).toBe("loosening");
      expect(
        classifyTransition(g.from, g.to, { guards: others }),
        `${g.id} is not load-bearing — dropping it changed nothing`,
      ).not.toBe("loosening");
    }
  });

  test("dropping a guard leaves its SIBLINGS still refusing", async () => {
    // The complement: a "fix" that made one drop disable the whole ratchet
    // would pass the leg above while destroying the other two guards.
    const { LOOSENING_GUARDS, classifyTransition } = await ratchet();
    for (const g of LOOSENING_GUARDS) {
      const others = LOOSENING_GUARDS.filter((x) => x.id !== g.id);
      for (const sibling of others) {
        expect(
          classifyTransition(sibling.from, sibling.to, { guards: others }),
          `${g.id} dropped: sibling ${sibling.id} stopped refusing`,
        ).toBe("loosening");
      }
    }
  });

  test("dropping a guard is what lets its pair through assertRatchet", async () => {
    // Scored at the throwing entry point, not only the classifier.
    const { LOOSENING_GUARDS, assertRatchet } = await ratchet();
    for (const g of LOOSENING_GUARDS) {
      const others = LOOSENING_GUARDS.filter((x) => x.id !== g.id);
      expect(others.length).toBe(LOOSENING_GUARDS.length - 1);
      expectNfr10Refusal(
        () => assertRatchet(g.from, g.to),
        `${g.id} with the full guard set`,
      );
      expect(
        () => assertRatchet(g.from, g.to, { guards: others }),
        `${g.id}: the guard is inert`,
      ).not.toThrow();
    }
  });

  test("with EVERY guard dropped, no loosening pair is refused by the ratchet itself", async () => {
    // Proves the guards — not some unrelated fail-closed default — are what
    // refuse the loosening pairs at the ratchet layer.
    const { assertRatchet } = await ratchet();
    for (const [from, to] of LOOSENING_PAIRS) {
      expect(
        () => assertRatchet(from, to, { guards: [] }),
        `${from}→${to} still refused with no guards — the guards are decorative`,
      ).not.toThrow();
    }
  });
});

// ---------------------------------------------------------------------------
// The probe.
// ---------------------------------------------------------------------------

/** Build a throwaway project tree carrying plugin SKILL.md / docs files. */
function makeFixture(files: Record<string, string>): {
  root: string;
  cleanup: () => void;
} {
  const root = mkdtempSync(join(tmpdir(), "merge-policy-ratchet-"));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, "plugins", "dev-process-toolkit", rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, body);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/** Build a throwaway PROJECT ROOT with (optionally) an `## Orchestration` block. */
function makeProject(orchestrationLine: string | null): {
  root: string;
  claudeMd: string;
  cleanup: () => void;
} {
  const root = mkdtempSync(join(tmpdir(), "merge-policy-run-"));
  const claudeMd = join(root, "CLAUDE.md");
  if (orchestrationLine !== null) {
    writeFileSync(
      claudeMd,
      ["# Project", "", "## Orchestration", "", orchestrationLine, ""].join("\n"),
    );
  }
  return { root, claudeMd, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function compliantCarrier(anchor: string, phrases: string[]): string {
  return [
    "---",
    "name: fixture-skill",
    "---",
    "",
    "# Fixture Skill",
    "",
    `A ${anchor} only ever tightens. It never performs`,
    `${phrases.join(", ")} — no spoken instruction reaches that state.`,
    "",
  ].join("\n");
}

describe("AC-STE-494.5 — the probe is non-vacuous in BOTH directions", () => {
  test("the module exports its probe id under the registered name", async () => {
    const { PROBE_ID } = await probeModule();
    expect(PROBE_ID).toBe(PROBE_ID_EXPECTED);
  });

  test("the required phrases are DERIVED from the guards, not a second copy", async () => {
    const { requiredRatchetPhrases } = await probeModule();
    const { LOOSENING_GUARDS, ENABLING_ACT_PHRASE } = await ratchet();
    expect(requiredRatchetPhrases().sort()).toEqual(
      [...LOOSENING_GUARDS.map((g) => g.prosePhrase), ENABLING_ACT_PHRASE].sort(),
    );
  });

  test("a carrier naming every refused transition ⇒ zero violations", async () => {
    const { runMergePolicyOverrideRatchetProbe, requiredRatchetPhrases } =
      await probeModule();
    const { OVERRIDE_ANCHOR } = await ratchet();
    const fx = makeFixture({
      "skills/fixture-skill/SKILL.md": compliantCarrier(
        OVERRIDE_ANCHOR,
        requiredRatchetPhrases(),
      ),
    });
    try {
      const r = await runMergePolicyOverrideRatchetProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("a carrier missing ONE required phrase ⇒ at least one violation, per phrase", async () => {
    const { runMergePolicyOverrideRatchetProbe, requiredRatchetPhrases } =
      await probeModule();
    const { OVERRIDE_ANCHOR } = await ratchet();
    const phrases = requiredRatchetPhrases();
    expect(phrases.length).toBeGreaterThanOrEqual(4);
    for (const missing of phrases) {
      const kept = phrases.filter((p) => p !== missing);
      expect(kept.length).toBe(phrases.length - 1); // mutation applied
      const body = compliantCarrier(OVERRIDE_ANCHOR, kept);
      expect(body).not.toContain(missing);
      const fx = makeFixture({ "skills/fixture-skill/SKILL.md": body });
      try {
        const r = await runMergePolicyOverrideRatchetProbe(fx.root);
        expect(
          r.violations.length,
          `dropping "${missing}" produced no violation`,
        ).toBeGreaterThanOrEqual(1);
        expect(r.violations.some((v) => v.reason.includes(missing))).toBe(true);
      } finally {
        fx.cleanup();
      }
    }
  });

  test("the violation carries the NFR-10 canonical shape", async () => {
    const { runMergePolicyOverrideRatchetProbe } = await probeModule();
    const { OVERRIDE_ANCHOR } = await ratchet();
    const fx = makeFixture({
      "skills/fixture-skill/SKILL.md": compliantCarrier(OVERRIDE_ANCHOR, []),
    });
    try {
      const r = await runMergePolicyOverrideRatchetProbe(fx.root);
      const v = r.violations[0]!;
      expect(v.severity).toBe("error");
      expect(v.note).toMatch(/^.+:\d+ — .+$/);
      expect(v.note).toContain("fixture-skill");
      expect(v.message).toContain("Remedy:");
      expect(v.message).toContain("Context:");
      expect(v.message).toContain(PROBE_ID_EXPECTED);
      expect(v.line).toBeGreaterThanOrEqual(1);
    } finally {
      fx.cleanup();
    }
  });

  test("SCOPE GUARD: a file that never names the override is out of scope", async () => {
    // Without this the probe would demand the ratchet prose of every file in
    // the tree — a false red on nearly all of them.
    const { runMergePolicyOverrideRatchetProbe } = await probeModule();
    const fx = makeFixture({
      "skills/plain-skill/SKILL.md":
        "---\nname: plain\n---\n\n# Plain\n\nNothing here.\n",
      "docs/plain-doc.md": "# Plain doc\n\nNo merge-policy vocabulary at all.\n",
    });
    try {
      const r = await runMergePolicyOverrideRatchetProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("docs carriers are in scope too — the ratchet cannot be documented away in docs/", async () => {
    const { runMergePolicyOverrideRatchetProbe } = await probeModule();
    const { OVERRIDE_ANCHOR } = await ratchet();
    const fx = makeFixture({
      "docs/fixture-reference.md": compliantCarrier(OVERRIDE_ANCHOR, []),
    });
    try {
      const r = await runMergePolicyOverrideRatchetProbe(fx.root);
      expect(r.violations.length).toBeGreaterThanOrEqual(1);
      expect(r.violations[0]!.note).toContain("fixture-reference.md");
    } finally {
      fx.cleanup();
    }
  });

  test("VACUOUS: no plugin tree at all ⇒ zero violations, no crash", async () => {
    const { runMergePolicyOverrideRatchetProbe } = await probeModule();
    const fx = makeFixture({});
    try {
      const r = await runMergePolicyOverrideRatchetProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("the probe is clean on this repository", async () => {
    const { runMergePolicyOverrideRatchetProbe } = await probeModule();
    const r = await runMergePolicyOverrideRatchetProbe(REPO_ROOT);
    expect(r.violations.map((v) => v.note)).toEqual([]);
  });

  test("this repository is a real subject — /deliver IS a carrier", async () => {
    // A clean probe over a tree with no carriers is vacuous. The shipped
    // /deliver SKILL.md must name the anchor, so the clean result above is
    // evidence rather than absence.
    const { OVERRIDE_ANCHOR } = await ratchet();
    expect(OVERRIDE_ANCHOR.length).toBeGreaterThan(0);
    expect(skillBody("deliver")).toContain(OVERRIDE_ANCHOR);
  });
});

describe("AC-STE-494.5 — the probe is registered in /gate-check", () => {
  const gateCheck = (): string => skillBody("gate-check");
  const rowsFor = (n: number): string[] =>
    gateCheck()
      .split("\n")
      .filter((l) => l.startsWith(`${n}. `));

  test(`the registry carries row #${NEW_PROBE_NUMBER} naming the probe id`, () => {
    const rows = rowsFor(NEW_PROBE_NUMBER);
    expect(rows.length, `no probe #${NEW_PROBE_NUMBER} row`).toBe(1);
    expect(rows[0]!).toContain(`\`${PROBE_ID_EXPECTED}\``);
  });

  test("the row names the module, the runner, the severity, and its test coverage", () => {
    const row = rowsFor(NEW_PROBE_NUMBER)[0]!;
    expect(row).toContain("adapters/_shared/src/merge_policy_override_ratchet.ts");
    expect(row).toContain("runMergePolicyOverrideRatchetProbe(projectRoot)");
    expect(row).toContain("Severity: error");
    expect(row).toContain("tests/m129-ste-494-merge-policy-ratchet.test.ts");
  });

  test("the row does not displace probe #77", () => {
    // A registration that renumbers an existing row breaks every pin that names
    // it. #77 stays where M126 put it.
    const row77 = rowsFor(77);
    expect(row77.length).toBe(1);
    expect(row77[0]!).toContain("`first_turn_refusal_marker`");
  });

  test("row #79 does not collide with row #78", () => {
    // The joint sweep lands #78 (STE-493) and #79 (this FR). A row that
    // duplicated the other's id would leave one probe unregistered.
    const row78 = rowsFor(78);
    expect(row78.length).toBe(1);
    expect(row78[0]!).not.toContain(`\`${PROBE_ID_EXPECTED}\``);
  });

  test("both shared modules exist on disk under their pinned paths", () => {
    expect(existsSync(RATCHET_MODULE_FILE)).toBe(true);
    expect(existsSync(PROBE_MODULE_FILE)).toBe(true);
  });
});

// ===========================================================================
// AC-STE-494.6 — the override never persists to CLAUDE.md.
// ===========================================================================

describe("AC-STE-494.6 — a real round trip: CLAUDE.md's bytes do not move", () => {
  test("applying an override leaves CLAUDE.md BYTE-IDENTICAL", async () => {
    const { runMergePolicy, overrideFromStatement, confirmOverride, applyOverride } =
      await ratchet();
    const fx = makeProject("merge_policy: auto");
    try {
      const before = readFileSync(fx.claudeMd);
      const run = runMergePolicy(fx.root);
      expect(run.effective, "fixture did not configure auto").toBe(P.auto);
      const after = applyOverride(
        run,
        confirmOverride(overrideFromStatement("don't merge anything", P.auto)),
      );
      expect(after.effective).toBe(P.never);
      const now = readFileSync(fx.claudeMd);
      expect(now.equals(before), "CLAUDE.md was rewritten by the override").toBe(
        true,
      );
    } finally {
      fx.cleanup();
    }
  });

  test("NON-VACUITY: the same byte comparison FAILS when the file really changes", () => {
    // Proves the comparison above can go red. A buffer equality that nothing
    // ever perturbs is not evidence.
    const fx = makeProject("merge_policy: auto");
    try {
      const before = readFileSync(fx.claudeMd);
      writeFileSync(fx.claudeMd, `${read(fx.claudeMd)}merge_policy: never\n`);
      expect(readFileSync(fx.claudeMd).equals(before)).toBe(false);
    } finally {
      fx.cleanup();
    }
  });

  test("a FRESH read after the override still returns the CONFIGURED value", async () => {
    // The override lives in run state. Re-reading the project must not show it.
    const { runMergePolicy, proposeOverride, confirmOverride, applyOverride } =
      await ratchet();
    const fx = makeProject("merge_policy: offer");
    try {
      const run = runMergePolicy(fx.root);
      applyOverride(run, confirmOverride(proposeOverride(P.offer, P.never)));
      expect(runMergePolicy(fx.root).effective).toBe(P.offer);
      expect(runMergePolicy(fx.root).override).toBeNull();
    } finally {
      fx.cleanup();
    }
  });

  test("applyOverride does not mutate the run value it was given", async () => {
    const { proposeOverride, confirmOverride, applyOverride } = await ratchet();
    const run: RunMergePolicy = {
      configured: P.auto,
      effective: P.auto,
      override: null,
    };
    applyOverride(run, confirmOverride(proposeOverride(P.auto, P.never)));
    expect(run.effective).toBe(P.auto);
    expect(run.override).toBeNull();
  });

  test("the module holds no write capability at all", async () => {
    // A round trip proves this path does not write. This proves NO path does:
    // the module never imports a writer, a mkdir, or a child process.
    const src = read(RATCHET_MODULE_FILE);
    for (const forbidden of [
      "writeFileSync",
      "appendFileSync",
      "mkdirSync",
      "rmSync",
      "createWriteStream",
      "execSync",
      "spawnSync",
      "child_process",
    ]) {
      expect(src, `the ratchet module reaches for ${forbidden}`).not.toContain(
        forbidden,
      );
    }
  });

  test("persisting stays a SEPARATE, explicit operator request, stated on the surface", () => {
    const body = skillBody("deliver");
    const lines = body.split("\n");
    const stated = lines.some(
      (l) =>
        /CLAUDE\.md/.test(l) &&
        /(not|never) (written|persisted|saved)|does not persist|never persists/i.test(l),
    );
    expect(
      stated,
      "deliver/SKILL.md never says the override is not written to CLAUDE.md",
    ).toBe(true);
    expect(body.toLowerCase()).toMatch(/separate (and )?explicit|explicit(ly)? ask|ask for it separately/);
  });

  test("NON-VACUITY: the surface predicate fails on the pre-FR body shape", () => {
    // Proves the prose pin above can go red rather than matching any markdown.
    const pre = "# Deliver\n\nRoute on merge_policy after each PR.\n";
    const stated = pre
      .split("\n")
      .some(
        (l) =>
          /CLAUDE\.md/.test(l) &&
          /(not|never) (written|persisted|saved)|does not persist|never persists/i.test(
            l,
          ),
      );
    expect(stated).toBe(false);
  });
});

// ===========================================================================
// AC-STE-494.7 — the supersession argument, IN THE FR BODY.
// ===========================================================================

/**
 * The claims AC-STE-494.7 requires in writing. Factored so BOTH the live FR
 * body and stripped copies run through the same predicate — a pin whose
 * predicate is never shown to fail is not a pin.
 */
function missingSupersessionClaims(body: string): string[] {
  const missing: string[] = [];
  if (!body.includes("STE-463")) missing.push("names STE-463");
  if (!body.includes("STE-464")) missing.push("names STE-464");
  if (!/STE-463[\s\S]{0,120}?AC\.3/.test(body)) {
    missing.push("names STE-463 AC.3 specifically");
  }
  if (!/STE-464[\s\S]{0,120}?AC\.7/.test(body)) {
    missing.push("names STE-464 AC.7 specifically");
  }
  if (!/`?auto`? is never inferred/.test(body)) {
    missing.push("quotes the guarantee: auto is never inferred");
  }
  if (
    !/no tightening transition has `?auto`? as its target|tightening transition cannot produce `?auto`?/.test(
      body,
    )
  ) {
    missing.push("argues that no tightening transition targets auto");
  }
  if (!/by construction/i.test(body)) {
    missing.push("argues the property is preserved by construction");
  }
  return missing;
}

describe("AC-STE-494.7 — the FR records why this contradicts neither prior AC", () => {
  test("the FR body carries every claim the AC requires", () => {
    expect(missingSupersessionClaims(read(frPath()))).toEqual([]);
  });

  test("the argument lives in the Technical Design, not only the Summary", () => {
    // The plan's mitigation for the "reviewer correctly kills the change" risk
    // is specifically that the argument is in the FR file, where it is read.
    const body = read(frPath());
    const idx = body.indexOf("## Technical Design");
    expect(idx).toBeGreaterThan(0);
    expect(missingSupersessionClaims(body.slice(idx))).toEqual([]);
  });

  test("NON-VACUITY: stripping the STE-464 reference is detected on its own", () => {
    const stripped = read(frPath()).replace(/STE-464/g, "the deliver FR");
    expect(stripped).not.toContain("STE-464"); // mutation applied
    expect(missingSupersessionClaims(stripped)).toContain("names STE-464");
  });

  test("NON-VACUITY: stripping the quoted guarantee is detected on its own", () => {
    const body = read(frPath());
    const stripped = body.replace(/is never inferred/g, "is rarely inferred");
    expect(stripped).not.toContain("is never inferred"); // mutation applied
    expect(missingSupersessionClaims(stripped)).toContain(
      "quotes the guarantee: auto is never inferred",
    );
  });

  test("NON-VACUITY: stripping the by-construction argument is detected on its own", () => {
    const body = read(frPath());
    const stripped = body.replace(/by construction/gi, "at runtime");
    expect(/by construction/i.test(stripped)).toBe(false); // mutation applied
    expect(missingSupersessionClaims(stripped)).toContain(
      "argues the property is preserved by construction",
    );
  });

  test("the argument is TRUE of the shipped code, not merely asserted in prose", async () => {
    // The half that stops the FR from arguing something the module does not do:
    // the claim "no tightening transition has `auto` as its target" is checked
    // against the shipped transition list, and the guarantee it preserves is
    // checked against the shipped orchestration-config header.
    const { TIGHTENING_TRANSITIONS } = await ratchet();
    for (const [, to] of TIGHTENING_TRANSITIONS) {
      expect(to).not.toBe(P.auto);
    }
    expect(read(join(SHARED_SRC, "orchestration_config.ts"))).toContain(
      "`auto` is never inferred",
    );
  });

  test("the STE-464 post-PR routing this FR rides on is still the shipped one", () => {
    // AC-STE-464.7's three behaviors. The override changes which policy is in
    // effect; it must not change what each policy means.
    const body = skillBody("deliver");
    expect(body).toContain("Post-PR — merge-policy routing");
    expect(body).toContain("Exactly three policies, exactly three behaviors");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-494.7 — the STE-464 half must be an ARGUMENT, not a mention.
//
// Audit finding: within the Technical Design slice, `by construction` and the
// no-auto-target claim were already satisfied by the paragraph that predates
// the supersession section, so deleting the whole "### Why this contradicts
// neither prior AC" block failed only the two token checks. A bare sentence
// "STE-464 AC.7 is fine" would have passed missingSupersessionClaims.
//
// AC.7 asks for the argument IN WRITING precisely because a reviewer who does
// not see it will correctly reject the change. A pin that a mention satisfies
// does not protect that.
// ---------------------------------------------------------------------------

describe("AC-STE-494.7 — the STE-464 half is argued, not merely named", () => {
  const supersessionSection = (): string => {
    const body = read(frPath());
    const i = body.indexOf("### Why this contradicts neither prior AC");
    if (i < 0) return "";
    const rest = body.slice(i + 1);
    const end = rest.search(/\n#{2,3} /);
    return end === -1 ? body.slice(i) : body.slice(i, i + 1 + end);
  };

  test("the dedicated supersession section exists", () => {
    expect(supersessionSection().length).toBeGreaterThan(0);
  });

  // The two ACs protect DIFFERENT properties, and the section has to say so —
  // that distinction is the whole argument. STE-463 AC.3 is about how the value
  // is READ (inference); STE-464 AC.7 is about what can ENABLE it.
  test("it distinguishes the inference claim from the enabling claim", () => {
    const s = supersessionSection().toLowerCase();
    expect(s).toMatch(/inference/);
    expect(s).toMatch(/enabl/);
  });

  // The STE-464 half's reason is non-persistence: the config file stays the
  // sole surface on which auto can be enabled. Without that, naming STE-464 is
  // just a restatement of the STE-463 argument.
  test("the STE-464 half rests on non-persistence, its own distinct ground", () => {
    const s = supersessionSection().toLowerCase();
    expect(s).toMatch(/non-persistent|never persists|does not persist|never writes/);
    expect(s).toMatch(/claude\.md/);
    expect(s).toMatch(/sole surface|only surface/);
  });

  // MUTATION-STYLE: the section must carry substance beyond the token pair.
  // A bare "STE-464 AC.7 is fine" is ~25 chars; a real argument is not.
  test("the section is an argument by length as well as by content", () => {
    expect(supersessionSection().length).toBeGreaterThan(600);
  });

  // NON-VACUITY — deleting the section must break THESE pins even though the
  // pre-existing paragraph would still satisfy the older token checks.
  test("NON-VACUITY: the needles are absent from the FR outside this section", () => {
    const body = read(frPath());
    const sec = supersessionSection();
    const outside = body.replace(sec, "");
    // Contiguous needles: the section writes "*enabling* claim" with markdown
    // emphasis, so the two-word phrase is not a substring of the rendered text.
    for (const needle of [
      "genuinely separate obligations",
      "sole surface on which",
    ]) {
      expect({ needle, inSection: sec.includes(needle) }).toEqual({
        needle,
        inSection: true,
      });
      expect({ needle, outside: outside.includes(needle) }).toEqual({
        needle,
        outside: false,
      });
    }
  });
});

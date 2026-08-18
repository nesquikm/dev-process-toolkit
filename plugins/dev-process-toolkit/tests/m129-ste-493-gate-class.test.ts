// M129 STE-493 — approval gates carry a class, and a standing authorization
// covers exactly one of them.
//
// WHAT IS BROKEN, measured. `skills/deliver/SKILL.md` § "Worker approval gates
// — relay to the operator" relays EVERY worker gate — "the `/implement` commit
// approval, the `/ship-milestone` release approval, the `/pr` push/PR
// confirmation, and any tracker-write prompts" — through one undifferentiated
// queue, and separately forbids both the auto-approve marker and any fabricated
// approval. On the current tree, a sweep for gate-class vocabulary returns
// nothing: `grep -rl "standing authorization\|gate class\|mechanical gate"
// skills/ docs/ adapters/` is empty. So the common operator instruction — drive
// the mechanics yourself, but never merge without me — is not expressible, and
// a live 2026-08-17 run spent operator attention re-asking a milestone number
// already chosen and a branch name with exactly one correct answer while the
// irreversible actions sat in the same queue.
//
// TEST STRATEGY, and why each half is not a tautology.
//
//   * MODULE PINS (Tier 1). The taxonomy, the delegation lifecycle, and the
//     irreversible-class exclusion live in `adapters/_shared/src/gate_class.ts`
//     and are exercised as CODE, never as prose greps. Prose is pinned too, but
//     only as the second half of a pair whose first half is behavioural.
//   * THE AC.2 SPINE IS BEHAVIOURAL. AC-STE-493.2 is the backward-compatibility
//     AC: a run in which the operator says nothing must behave exactly as it
//     does today. It is pinned as `relayRequired(gate, null) === true` for EVERY
//     registered gate of EVERY class — a default that flips takes this red — and
//     paired with its own non-vacuity leg (`relayRequired(mechGate, confirmed)
//     === false`), without which "relay is always required" would pass a module
//     that had no delegation mechanism at all.
//   * DROP-ONE MUTATION OVER EVERY GUARD (AC.6). `IRREVERSIBLE_GUARDS` is an
//     exported list and both entry points accept a guard-list override, so each
//     guard is removed in turn and the verdict must flip. A guard that is not
//     load-bearing, or that is shadowed by a sibling guard, fails here. This is
//     the M126 lesson applied: a mutation that never applied reads as a pass, so
//     the drop is asserted to have changed the list length before it is scored.
//   * ISOLATION LEGS (AC.5, AC.6). The exclusion must be shown to exclude
//     SOMETHING and to permit something else, or "delegation never covers
//     anything" would satisfy every negative pin vacuously. Every mechanical
//     sample is asserted COVERED by the same general delegation that is refused
//     on every irreversible sample.
//   * BOTH DIRECTIONS OF AC.5. A general-sounding delegation must not reach the
//     irreversible class, AND a fresh instruction naming the action must — that
//     second half is what stops the fix from being "irreversible gates are
//     simply unreachable".
//
// DELIBERATE OMISSION — the global probe count. This FR registers `/gate-check`
// probe #78; STE-494 registers #79 in the SAME sweep (M129 plan, Risks table:
// "Land both probe registrations in one sweep rather than two, so the count-pin
// update happens once"). A `77 → 78` assertion here would be wrong the moment
// STE-494 lands, so this file pins ROW #78 by identity and asserts NO aggregate
// count. The aggregate pins (README's "numbered `/gate-check` probes" line, in
// `tests/gate-check-public-surface-count-drift.test.ts`) move 77 → 79 once, with
// STE-494.
//
// HARD BUDGETS, measured at authoring time (2026-08-17, v2.67.1):
//   * `skills/` tree: 246 / 246 STE-N tokens — ZERO headroom. New SKILL prose
//     must cite by mechanism, never by ticket id.
//   * `skills/deliver/SKILL.md`: 103 lines of a 358 cap, and ZERO STE-N tokens.
//   * `skills/gate-check/SKILL.md`: 345 lines of a 358 cap — 13 free, and rows
//     #78 and #79 both have to fit, one line each.
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

import { runAutoApproveMarkerProbe } from "../adapters/_shared/src/auto_approve_marker";

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
  const active = join(REPO_ROOT, "specs", "frs", "STE-493.md");
  if (existsSync(active)) return active;
  const archived = join(REPO_ROOT, "specs", "frs", "archive", "STE-493.md");
  if (existsSync(archived)) return archived;
  throw new Error("STE-493.md found in neither specs/frs/ nor specs/frs/archive/");
}

// ===========================================================================
// The modules under test, imported LAZILY.
//
// A top-level static import of a not-yet-written module aborts the whole file,
// which would collapse eight independent reds into one load error and hide
// which ACs are actually unmet.
// ===========================================================================

const GATE_CLASS_MODULE = "../adapters/_shared/src/gate_class";
const PROBE_MODULE = "../adapters/_shared/src/delegation_irreversible_exclusion";

const GATE_CLASS_MODULE_FILE = join(SHARED_SRC, "gate_class.ts");
const PROBE_MODULE_FILE = join(SHARED_SRC, "delegation_irreversible_exclusion.ts");

type GateClass = "content" | "mechanical" | "irreversible";

interface GateDescriptor {
  readonly id: string;
  readonly gateClass: GateClass;
  readonly decider: string;
  readonly summary: string;
}

interface IrreversibleGuard {
  /** Stable id — the drop-one mutation and the probe both key on it. */
  readonly id: string;
  /** The operator-facing phrase this guard forbids, e.g. `push to trunk`. */
  readonly actionPhrase: string;
  readonly reason: string;
  matches(gateText: string): boolean;
}

interface Delegation {
  readonly text: string;
  /** The restatement rendered back to the operator before it takes effect. */
  readonly restatement: string;
  /** False until `confirmDelegation` has put the restatement on the record. */
  readonly active: boolean;
}

type GateLike = string | GateDescriptor;

interface GateClassModule {
  GATE_CLASSES: readonly GateClass[];
  CLASS_DECIDERS: Record<GateClass, string>;
  GATE_REGISTRY: readonly GateDescriptor[];
  IRREVERSIBLE_GUARDS: readonly IrreversibleGuard[];
  DELEGATION_ANCHOR: string;
  DELEGATION_CARRY_CHANNEL: string;
  classifyGate(gate: GateLike): GateClass;
  gateFor(id: string): GateDescriptor | null;
  isIrreversibleGate(
    gate: GateLike,
    guards?: readonly IrreversibleGuard[],
  ): boolean;
  isDelegationStatement(text: string): boolean;
  proposeDelegation(text: string): Delegation;
  confirmDelegation(delegation: Delegation): Delegation;
  delegationCovers(
    delegation: string | Delegation | null,
    gate: GateLike,
    options?: { guards?: readonly IrreversibleGuard[] },
  ): boolean;
  freshInstructionAuthorizes(instruction: string, gate: GateLike): boolean;
  relayRequired(gate: GateLike, delegation: Delegation | null): boolean;
  carryDelegation(kickoffText: string, delegation: Delegation | null): string;
  assertDelegationChannel(channel: string): void;
}

async function gateClass(): Promise<GateClassModule> {
  return (await import(GATE_CLASS_MODULE)) as unknown as GateClassModule;
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
  requiredExclusionPhrases(): string[];
  runDelegationIrreversibleExclusionProbe(
    projectRoot: string,
  ): Promise<{ violations: ProbeViolation[] }>;
}

async function probeModule(): Promise<ProbeModule> {
  return (await import(PROBE_MODULE)) as unknown as ProbeModule;
}

// ===========================================================================
// Byte-pinned literals this contract is written in terms of.
// ===========================================================================

/** AC-STE-493.1 — exactly three, in this order. A fourth is a contract break. */
const EXPECTED_CLASSES: GateClass[] = ["content", "mechanical", "irreversible"];

/**
 * AC-STE-493.5 names five outward-facing actions. Each gets its OWN guard so
 * each can be dropped independently; a single regex covering all five would be
 * mutation-verifiable only as a unit, which is what AC-STE-493.6's "every guard
 * in it is mutation-verified" forbids.
 */
const EXPECTED_GUARD_IDS = [
  "merge",
  "push_to_trunk",
  "deploy",
  "publish",
  "outward_facing",
] as const;

/**
 * One gate text per guard, chosen so that EXACTLY ONE guard matches it. The
 * isolation is the point: if two guards both catch a sample, dropping either
 * leaves the other standing, the verdict does not flip, and the mutation proves
 * nothing about the dropped guard.
 */
const IRREVERSIBLE_SAMPLES: Record<string, string> = {
  merge: "merge the open pull request",
  push_to_trunk: "push the release commit to trunk",
  deploy: "deploy the built image to production",
  publish: "publish the package to the registry",
  outward_facing: "send an outward-facing announcement email",
};

/**
 * Registered gate ids this FR pins by identity. The registry may hold more; it
 * may not hold fewer, and it may not reclassify these.
 *
 * The mechanical three are exactly the gates the 2026-08-17 field report named
 * as wasted operator attention. `implement_commit_approval` stays CONTENT — it
 * decides what gets built, which no delegation touches.
 */
const PINNED_CLASSIFICATIONS: Record<string, GateClass> = {
  implement_commit_approval: "content",
  milestone_number_choice: "mechanical",
  branch_name_choice: "mechanical",
  tracker_write_prompt: "mechanical",
  merge_pr: "irreversible",
  push_to_trunk: "irreversible",
  deploy: "irreversible",
  publish: "irreversible",
};

const MECHANICAL_GATE_IDS = Object.entries(PINNED_CLASSIFICATIONS)
  .filter(([, c]) => c === "mechanical")
  .map(([id]) => id);

const IRREVERSIBLE_GATE_IDS = Object.entries(PINNED_CLASSIFICATIONS)
  .filter(([, c]) => c === "irreversible")
  .map(([id]) => id);

/**
 * The two general-sounding operator statements AC-STE-493.5 names verbatim.
 * Both must delegate the mechanical class and neither may reach the irreversible
 * one — that asymmetry, on the SAME input, is the whole AC.
 */
const GENERAL_DELEGATIONS = ["drive it yourself", "stop asking me"] as const;

/** A statement that is NOT a delegation — the negative half of the detector. */
const NOT_A_DELEGATION = "relay everything to me, I want to see each gate";

/** A stand-in kickoff task text; `carryDelegation` must leave it intact. */
const BASE_KICKOFF = [
  "Deliver milestone M129 at effort ultracode.",
  "Chain: /implement M129 -> /ship-milestone M129 -> /pr.",
].join("\n");

/** The probe slot this FR claims. #77 is the last shipped probe (M126). */
const NEW_PROBE_NUMBER = 78;
const PROBE_ID_EXPECTED = "delegation_irreversible_exclusion";

/**
 * The auto-approve marker, SOURCED from the shipped module rather than retyped.
 * `auto_approve_marker.ts` holds it in a module-private `const MARKER = "…"`, so
 * the literal is extracted from that declaration; a retyped copy would keep
 * reading green after the shipped marker drifted (the STE-485 lesson).
 */
function autoApproveMarkerLiteral(): string {
  const src = read(join(SHARED_SRC, "auto_approve_marker.ts"));
  const matches = [...src.matchAll(/const MARKER = "([^"]+)";/g)];
  if (matches.length !== 1) {
    throw new Error(
      `auto_approve_marker.ts: expected exactly one \`const MARKER = "…"\` ` +
        `declaration to source the literal from, found ${matches.length}`,
    );
  }
  return matches[0]![1]!;
}

const AUTO_APPROVE_MARKER = autoApproveMarkerLiteral();

// ===========================================================================
// TRIPWIRES — written first; they are what stops a bad "fix".
// ===========================================================================

describe("TRIPWIRE — the budgets this FR's edits ride against", () => {
  const SKILL_LINE_CAP = 358;
  const SKILLS_STE_TOKEN_CEILING = 246;

  test(`skills/deliver/SKILL.md stays within the NFR-1 line cap (${SKILL_LINE_CAP})`, () => {
    expect(skillBody("deliver").split("\n").length).toBeLessThanOrEqual(
      SKILL_LINE_CAP,
    );
  });

  test(`skills/gate-check/SKILL.md stays within the NFR-1 line cap (${SKILL_LINE_CAP})`, () => {
    // 345 / 358 at authoring time. Probe rows #78 (this FR) and #79 (STE-494)
    // must each be ONE line, like every row above them.
    expect(skillBody("gate-check").split("\n").length).toBeLessThanOrEqual(
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

  test("skills/deliver/SKILL.md still cites by mechanism, never by ticket id", () => {
    // The whole-tree ceiling above can be satisfied by deleting someone else's
    // token. This is the local rule, and deliver's measured count is ZERO.
    expect(skillBody("deliver").match(/\b(STE|AC-STE)-\d+(?:\.\d+)?\b/g)).toBeNull();
  });
});

// ===========================================================================
// AC-STE-493.1 — exactly three classes, each naming who decides.
// ===========================================================================

describe("AC-STE-493.1 — the taxonomy is a closed set of three", () => {
  test("GATE_CLASSES is exactly content / mechanical / irreversible, in order", async () => {
    const { GATE_CLASSES } = await gateClass();
    expect([...GATE_CLASSES]).toEqual(EXPECTED_CLASSES);
  });

  test("every class names a decider, and the three deciders are distinct", async () => {
    const { GATE_CLASSES, CLASS_DECIDERS } = await gateClass();
    const deciders: string[] = [];
    for (const c of GATE_CLASSES) {
      const d = CLASS_DECIDERS[c];
      expect(d, `class ${c} names no decider`).toBeDefined();
      expect(d!.trim().length).toBeGreaterThan(0);
      deciders.push(d!);
    }
    // Three classes whose deciders are the same string would be one class
    // wearing three names.
    expect(new Set(deciders).size).toBe(3);
  });

  test("CLASS_DECIDERS has no key outside the closed set", async () => {
    const { CLASS_DECIDERS } = await gateClass();
    expect(Object.keys(CLASS_DECIDERS).sort()).toEqual([...EXPECTED_CLASSES].sort());
  });

  test("the irreversible class's decider says it is never delegable", async () => {
    const { CLASS_DECIDERS } = await gateClass();
    expect(CLASS_DECIDERS.irreversible.toLowerCase()).toMatch(
      /never|not deleg|no deleg/,
    );
  });

  test("every registered gate carries a class from the closed set", async () => {
    const { GATE_REGISTRY, GATE_CLASSES } = await gateClass();
    expect(GATE_REGISTRY.length).toBeGreaterThan(0);
    for (const g of GATE_REGISTRY) {
      expect([...GATE_CLASSES], `gate ${g.id}`).toContain(g.gateClass);
    }
  });

  test("every registered gate's decider agrees with its class's decider", async () => {
    const { GATE_REGISTRY, CLASS_DECIDERS } = await gateClass();
    for (const g of GATE_REGISTRY) {
      expect(g.decider, `gate ${g.id} decider drifted from its class`).toBe(
        CLASS_DECIDERS[g.gateClass],
      );
    }
  });

  test("all three classes are actually populated — none is a dead branch", async () => {
    const { GATE_REGISTRY, GATE_CLASSES } = await gateClass();
    for (const c of GATE_CLASSES) {
      expect(
        GATE_REGISTRY.filter((g) => g.gateClass === c).length,
        `class ${c} has no registered gate`,
      ).toBeGreaterThan(0);
    }
  });

  test("the field-report gates classify as pinned", async () => {
    const { classifyGate, gateFor } = await gateClass();
    for (const [id, cls] of Object.entries(PINNED_CLASSIFICATIONS)) {
      expect(gateFor(id), `gate ${id} is not registered`).not.toBeNull();
      expect(classifyGate(id), `gate ${id}`).toBe(cls);
    }
  });

  test("an unregistered, unguarded gate falls back to content — fail-closed", async () => {
    // The conservative default: an unknown gate is relayed, never delegated.
    const { classifyGate } = await gateClass();
    expect(classifyGate("some gate nobody registered")).toBe("content");
  });
});

describe("AC-STE-493.1 — the operative surface names the three classes and their deciders", () => {
  test("one line of skills/deliver/SKILL.md names all three classes", async () => {
    const { GATE_CLASSES } = await gateClass();
    const lines = skillBody("deliver").split("\n");
    const hit = lines.filter((l) => GATE_CLASSES.every((c) => l.includes(c)));
    expect(hit.length, "no single line names all three gate classes").toBeGreaterThanOrEqual(1);
  });

  test("each class is stated alongside who decides it", async () => {
    const { GATE_CLASSES } = await gateClass();
    const lines = skillBody("deliver").split("\n");
    for (const c of GATE_CLASSES) {
      const stated = lines.some((l) => l.includes(c) && /decide/i.test(l));
      expect(stated, `deliver/SKILL.md never says who decides the ${c} class`).toBe(
        true,
      );
    }
  });

  test("NON-VACUITY: the same predicate fails on the pre-FR surface shape", async () => {
    // Proves the two pins above can go red: a body with no class vocabulary
    // must fail them. Without this leg, a predicate that is trivially true of
    // any markdown would read as coverage.
    const { GATE_CLASSES } = await gateClass();
    const pre = "# Deliver\n\nRelay every gate to the operator.\n";
    const lines = pre.split("\n");
    expect(lines.some((l) => GATE_CLASSES.every((c) => l.includes(c)))).toBe(false);
  });
});

// ===========================================================================
// AC-STE-493.2 — relay-every-gate remains the shipped default.
//
// The backward-compatibility spine. Behavioural, not prose: this is what goes
// red if the default path changes.
// ===========================================================================

describe("AC-STE-493.2 — with NO delegation, every gate still relays", () => {
  test("relayRequired is true for EVERY registered gate when delegation is null", async () => {
    const { GATE_REGISTRY, relayRequired } = await gateClass();
    for (const g of GATE_REGISTRY) {
      expect(relayRequired(g, null), `gate ${g.id} stopped relaying by default`).toBe(
        true,
      );
    }
  });

  test("the mechanical class in particular still relays by default", async () => {
    // Named separately because the mechanical class is the ONLY one a
    // delegation can ever silence — a regression lands here first.
    const { relayRequired, gateFor } = await gateClass();
    for (const id of MECHANICAL_GATE_IDS) {
      const g = gateFor(id);
      expect(g, `gate ${id} is not registered`).not.toBeNull();
      expect(relayRequired(g!, null), `mechanical gate ${id}`).toBe(true);
    }
    expect(MECHANICAL_GATE_IDS.length).toBeGreaterThanOrEqual(3);
  });

  test("NON-VACUITY: relayRequired is NOT a constant — a confirmed delegation silences the mechanical class", async () => {
    // Without this leg, a module with no delegation mechanism at all would
    // satisfy every assertion above.
    const { relayRequired, confirmDelegation, proposeDelegation, gateFor } =
      await gateClass();
    const d = confirmDelegation(proposeDelegation(GENERAL_DELEGATIONS[0]));
    for (const id of MECHANICAL_GATE_IDS) {
      expect(relayRequired(gateFor(id)!, d), `mechanical gate ${id}`).toBe(false);
    }
  });

  test("a confirmed delegation does NOT silence the content class", async () => {
    const { relayRequired, confirmDelegation, proposeDelegation, gateFor } =
      await gateClass();
    const d = confirmDelegation(proposeDelegation(GENERAL_DELEGATIONS[0]));
    expect(relayRequired(gateFor("implement_commit_approval")!, d)).toBe(true);
  });

  test("a confirmed delegation does NOT silence the irreversible class", async () => {
    const { relayRequired, confirmDelegation, proposeDelegation, gateFor } =
      await gateClass();
    const d = confirmDelegation(proposeDelegation(GENERAL_DELEGATIONS[0]));
    for (const id of IRREVERSIBLE_GATE_IDS) {
      expect(relayRequired(gateFor(id)!, d), `irreversible gate ${id}`).toBe(true);
    }
  });

  test("a silent run's kickoff text is BYTE-IDENTICAL to today's", async () => {
    const { carryDelegation } = await gateClass();
    expect(carryDelegation(BASE_KICKOFF, null)).toBe(BASE_KICKOFF);
  });

  test("the shipped relay prose survives the edit", () => {
    // Tripwire: this FR EXTENDS the relay section. A fix that rewrites the
    // default away has traded one gap for another.
    const body = skillBody("deliver");
    expect(body).toContain("relays it to the operator via AskUserQuestion");
    expect(body).toContain("The operator is the only approver in this pipeline.");
    expect(body).toContain("never fabricates an approval");
  });
});

// ===========================================================================
// AC-STE-493.3 — restated back once before it takes effect.
// ===========================================================================

describe("AC-STE-493.3 — a delegation is restated before it is in effect", () => {
  test("a proposed delegation is NOT active", async () => {
    const { proposeDelegation } = await gateClass();
    expect(proposeDelegation(GENERAL_DELEGATIONS[0]).active).toBe(false);
  });

  test("the restatement names the mechanical class and every excluded action", async () => {
    const { proposeDelegation, IRREVERSIBLE_GUARDS } = await gateClass();
    const { restatement } = proposeDelegation(GENERAL_DELEGATIONS[0]);
    expect(restatement.trim().length).toBeGreaterThan(40);
    expect(restatement).toContain("mechanical");
    for (const g of IRREVERSIBLE_GUARDS) {
      expect(restatement, `restatement omits ${g.actionPhrase}`).toContain(
        g.actionPhrase,
      );
    }
  });

  test("the restatement states the scope in time — the rest of the run", async () => {
    const { proposeDelegation } = await gateClass();
    expect(proposeDelegation(GENERAL_DELEGATIONS[1]).restatement).toMatch(
      /rest of (this|the) run/i,
    );
  });

  test("the restatement carries the operator's own words back", async () => {
    const { proposeDelegation } = await gateClass();
    for (const text of GENERAL_DELEGATIONS) {
      expect(proposeDelegation(text).restatement).toContain(text);
    }
  });

  test("an UNCONFIRMED delegation covers nothing — not even a mechanical gate", async () => {
    const { proposeDelegation, delegationCovers, gateFor } = await gateClass();
    const proposed = proposeDelegation(GENERAL_DELEGATIONS[0]);
    for (const id of MECHANICAL_GATE_IDS) {
      expect(delegationCovers(proposed, gateFor(id)!), `gate ${id}`).toBe(false);
    }
  });

  test("NON-VACUITY: confirming the SAME delegation makes it cover those gates", async () => {
    // The A/B control for the pin above: same input, restatement the only
    // difference. Without it, "covers nothing" would be indistinguishable from
    // a delegation mechanism that never works.
    const { proposeDelegation, confirmDelegation, delegationCovers, gateFor } =
      await gateClass();
    const confirmed = confirmDelegation(proposeDelegation(GENERAL_DELEGATIONS[0]));
    expect(confirmed.active).toBe(true);
    for (const id of MECHANICAL_GATE_IDS) {
      expect(delegationCovers(confirmed, gateFor(id)!), `gate ${id}`).toBe(true);
    }
  });

  test("confirmation preserves the operator's text and the restatement", async () => {
    const { proposeDelegation, confirmDelegation } = await gateClass();
    const proposed = proposeDelegation(GENERAL_DELEGATIONS[0]);
    const confirmed = confirmDelegation(proposed);
    expect(confirmed.text).toBe(proposed.text);
    expect(confirmed.restatement).toBe(proposed.restatement);
  });

  test("a statement that is not a delegation is not detected as one", async () => {
    const { isDelegationStatement } = await gateClass();
    for (const text of GENERAL_DELEGATIONS) {
      expect(isDelegationStatement(text), `"${text}"`).toBe(true);
    }
    expect(isDelegationStatement(NOT_A_DELEGATION)).toBe(false);
    expect(isDelegationStatement("")).toBe(false);
  });

  test("proposing a delegation from non-delegation prose refuses in NFR-10 shape", async () => {
    const { proposeDelegation } = await gateClass();
    let raised: unknown = null;
    try {
      proposeDelegation(NOT_A_DELEGATION);
    } catch (e) {
      raised = e;
    }
    expect(raised, "non-delegation prose was accepted as a delegation").not.toBeNull();
    const msg = String((raised as Error).message);
    expect(msg).toContain("Refusing:");
    expect(msg).toContain("Remedy:");
    expect(msg).toContain("Context:");
  });

  test("skills/deliver/SKILL.md states the restate-once rule", () => {
    const body = skillBody("deliver").toLowerCase();
    expect(body).toContain("restate");
    expect(/restate[sd]? .*before it takes effect|before it takes effect/.test(body)).toBe(
      true,
    );
  });
});

// ===========================================================================
// AC-STE-493.4 — carried in kickoff text only, never mid-run.
// ===========================================================================

describe("AC-STE-493.4 — the delegation reaches later workers through kickoff text", () => {
  test("the carry channel is the kickoff text", async () => {
    const { DELEGATION_CARRY_CHANNEL } = await gateClass();
    expect(DELEGATION_CARRY_CHANNEL).toBe("kickoff");
  });

  test("a confirmed delegation is appended to the kickoff text, base preserved", async () => {
    const { proposeDelegation, confirmDelegation, carryDelegation } =
      await gateClass();
    const d = confirmDelegation(proposeDelegation(GENERAL_DELEGATIONS[0]));
    const out = carryDelegation(BASE_KICKOFF, d);
    expect(out).toContain(BASE_KICKOFF);
    expect(out.length).toBeGreaterThan(BASE_KICKOFF.length);
    expect(out).toContain(d.restatement);
  });

  test("the carried text names every excluded action, so the worker cannot infer wider scope", async () => {
    const { proposeDelegation, confirmDelegation, carryDelegation, IRREVERSIBLE_GUARDS } =
      await gateClass();
    const d = confirmDelegation(proposeDelegation(GENERAL_DELEGATIONS[1]));
    const out = carryDelegation(BASE_KICKOFF, d);
    for (const g of IRREVERSIBLE_GUARDS) {
      expect(out, `kickoff carry omits ${g.actionPhrase}`).toContain(g.actionPhrase);
    }
  });

  test("an UNCONFIRMED delegation is not carried — restate-before-effect holds here too", async () => {
    const { proposeDelegation, carryDelegation } = await gateClass();
    expect(carryDelegation(BASE_KICKOFF, proposeDelegation(GENERAL_DELEGATIONS[0]))).toBe(
      BASE_KICKOFF,
    );
  });

  test("delivering a delegation as a mid-run message REFUSES", async () => {
    const { assertDelegationChannel } = await gateClass();
    expect(() => assertDelegationChannel("kickoff")).not.toThrow();
    let raised: unknown = null;
    try {
      assertDelegationChannel("mid-run-message");
    } catch (e) {
      raised = e;
    }
    expect(raised, "a mid-run delegation message was permitted").not.toBeNull();
    const msg = String((raised as Error).message);
    expect(msg).toContain("Refusing:");
    expect(msg).toContain("Remedy:");
    expect(msg).toContain("Context:");
  });

  test("skills/deliver/SKILL.md states kickoff-carry and forbids the mid-run message", () => {
    const body = skillBody("deliver");
    const lower = body.toLowerCase();
    expect(lower).toContain("kickoff");
    expect(
      /never .*mid-run|not .*mid-run|mid-run message|already-running worker/.test(lower),
      "deliver/SKILL.md never forbids injecting a delegation into a running worker",
    ).toBe(true);
  });
});

// ===========================================================================
// AC-STE-493.5 — the exclusion, in BOTH directions.
// ===========================================================================

describe("AC-STE-493.5 — a general delegation never reaches an outward-facing action", () => {
  test("every general-sounding statement is refused on every irreversible sample", async () => {
    const { proposeDelegation, confirmDelegation, delegationCovers } = await gateClass();
    for (const text of GENERAL_DELEGATIONS) {
      const d = confirmDelegation(proposeDelegation(text));
      for (const [guardId, sample] of Object.entries(IRREVERSIBLE_SAMPLES)) {
        expect(delegationCovers(d, sample), `"${text}" vs ${guardId}`).toBe(false);
      }
    }
  });

  test("the same statements are refused on every REGISTERED irreversible gate", async () => {
    const { proposeDelegation, confirmDelegation, delegationCovers, gateFor } =
      await gateClass();
    for (const text of GENERAL_DELEGATIONS) {
      const d = confirmDelegation(proposeDelegation(text));
      for (const id of IRREVERSIBLE_GATE_IDS) {
        expect(delegationCovers(d, gateFor(id)!), `"${text}" vs ${id}`).toBe(false);
      }
    }
  });

  test("ISOLATION: the same statements DO cover every mechanical gate", async () => {
    // Without this, "delegation never covers anything" would satisfy every
    // negative pin above — the exclusion would be vacuously true.
    const { proposeDelegation, confirmDelegation, delegationCovers, gateFor } =
      await gateClass();
    for (const text of GENERAL_DELEGATIONS) {
      const d = confirmDelegation(proposeDelegation(text));
      for (const id of MECHANICAL_GATE_IDS) {
        expect(delegationCovers(d, gateFor(id)!), `"${text}" vs ${id}`).toBe(true);
      }
    }
  });

  test("ISOLATION: no mechanical sample trips any irreversible guard", async () => {
    const { isIrreversibleGate, IRREVERSIBLE_GUARDS, gateFor } = await gateClass();
    for (const id of MECHANICAL_GATE_IDS) {
      const g = gateFor(id)!;
      expect(isIrreversibleGate(g), `mechanical gate ${id} tripped a guard`).toBe(false);
      const hits = IRREVERSIBLE_GUARDS.filter((guard) => guard.matches(g.summary));
      expect(hits.map((h) => h.id), `mechanical gate ${id}`).toEqual([]);
    }
  });

  test("the raw-text form of the operator's words behaves the same way", async () => {
    // `delegationCovers` also accepts the operator's bare statement, which is
    // how the orchestrator scores a statement before recording it.
    const { delegationCovers, gateFor } = await gateClass();
    for (const text of GENERAL_DELEGATIONS) {
      expect(delegationCovers(text, gateFor("merge_pr")!), text).toBe(false);
      expect(delegationCovers(text, gateFor("branch_name_choice")!), text).toBe(true);
    }
  });

  test("a null delegation covers nothing at all", async () => {
    const { delegationCovers, gateFor } = await gateClass();
    for (const id of Object.keys(PINNED_CLASSIFICATIONS)) {
      expect(delegationCovers(null, gateFor(id)!), id).toBe(false);
    }
  });
});

describe("AC-STE-493.5 — the other direction: a fresh instruction naming the action DOES authorize it", () => {
  test("an instruction naming the action authorizes that action", async () => {
    const { freshInstructionAuthorizes, gateFor } = await gateClass();
    expect(freshInstructionAuthorizes("merge the PR for M129 now", gateFor("merge_pr")!)).toBe(
      true,
    );
    expect(
      freshInstructionAuthorizes("publish the package now", gateFor("publish")!),
    ).toBe(true);
  });

  test("an instruction naming a DIFFERENT action does not authorize this one", async () => {
    const { freshInstructionAuthorizes, gateFor } = await gateClass();
    expect(
      freshInstructionAuthorizes("merge the PR for M129 now", gateFor("deploy")!),
    ).toBe(false);
    expect(
      freshInstructionAuthorizes("merge the PR for M129 now", gateFor("publish")!),
    ).toBe(false);
  });

  test("general prose authorizes no irreversible action, however emphatic", async () => {
    const { freshInstructionAuthorizes, gateFor } = await gateClass();
    for (const text of GENERAL_DELEGATIONS) {
      for (const id of IRREVERSIBLE_GATE_IDS) {
        expect(freshInstructionAuthorizes(text, gateFor(id)!), `"${text}" vs ${id}`).toBe(
          false,
        );
      }
    }
  });

  test("a fresh instruction is not a standing delegation — it does not persist", async () => {
    const { isDelegationStatement, delegationCovers, gateFor } = await gateClass();
    const instruction = "merge the PR for M129 now";
    expect(isDelegationStatement(instruction)).toBe(false);
    // Scored as a standing authorization, the same words still cover nothing
    // irreversible: authorization is per-instruction, never accumulated.
    expect(delegationCovers(instruction, gateFor("merge_pr")!)).toBe(false);
  });
});

// ===========================================================================
// AC-STE-493.6 — module + probe, every guard mutation-verified.
// ===========================================================================

describe("AC-STE-493.6 — the guard set is the one the AC names", () => {
  test("IRREVERSIBLE_GUARDS carries exactly the five named actions", async () => {
    const { IRREVERSIBLE_GUARDS } = await gateClass();
    expect(IRREVERSIBLE_GUARDS.map((g) => g.id).sort()).toEqual(
      [...EXPECTED_GUARD_IDS].sort(),
    );
  });

  test("every guard names an operator-facing action phrase and a reason", async () => {
    const { IRREVERSIBLE_GUARDS } = await gateClass();
    for (const g of IRREVERSIBLE_GUARDS) {
      expect(g.actionPhrase.trim().length, `guard ${g.id}`).toBeGreaterThan(0);
      expect(g.reason.trim().length, `guard ${g.id}`).toBeGreaterThan(10);
    }
    // Distinct phrases: two guards sharing a phrase are one guard.
    expect(new Set(IRREVERSIBLE_GUARDS.map((g) => g.actionPhrase)).size).toBe(
      IRREVERSIBLE_GUARDS.length,
    );
  });

  test("every guard has a sample this file mutation-tests it with", async () => {
    // Anti-drift: a sixth guard added without a sample would otherwise ship
    // un-mutated, which is exactly what AC.6 forbids.
    const { IRREVERSIBLE_GUARDS } = await gateClass();
    for (const g of IRREVERSIBLE_GUARDS) {
      expect(
        IRREVERSIBLE_SAMPLES[g.id],
        `guard ${g.id} has no mutation sample in this test file`,
      ).toBeDefined();
    }
  });
});

describe("AC-STE-493.6 — DROP-ONE MUTATION: every guard is load-bearing and isolated", () => {
  test("each sample is caught, and caught by EXACTLY ONE guard", async () => {
    const { IRREVERSIBLE_GUARDS, isIrreversibleGate } = await gateClass();
    for (const g of IRREVERSIBLE_GUARDS) {
      const sample = IRREVERSIBLE_SAMPLES[g.id]!;
      expect(isIrreversibleGate(sample), `${g.id}: sample not caught`).toBe(true);
      const hits = IRREVERSIBLE_GUARDS.filter((x) => x.matches(sample)).map((x) => x.id);
      expect(hits, `${g.id}: sample is not isolated`).toEqual([g.id]);
    }
  });

  test("dropping a guard flips its sample's verdict — every guard, one at a time", async () => {
    const { IRREVERSIBLE_GUARDS, isIrreversibleGate } = await gateClass();
    for (const g of IRREVERSIBLE_GUARDS) {
      const sample = IRREVERSIBLE_SAMPLES[g.id]!;
      const others = IRREVERSIBLE_GUARDS.filter((x) => x.id !== g.id);
      // MUTATION APPLIED? A mutation that silently never applied reads as a
      // pass, so the drop is measured before it is scored.
      expect(others.length, `${g.id}: drop did not apply`).toBe(
        IRREVERSIBLE_GUARDS.length - 1,
      );
      expect(isIrreversibleGate(sample, others), `${g.id} is not load-bearing`).toBe(
        false,
      );
    }
  });

  test("dropping a guard is what lets a general delegation through — at the public entry point", async () => {
    // Scored on `delegationCovers`, the function operators' safety actually
    // depends on, not only the internal predicate. The vehicle is a gate that
    // DECLARES itself mechanical while naming an irreversible action — the
    // mis-registration the guards exist to override.
    const {
      IRREVERSIBLE_GUARDS,
      delegationCovers,
      proposeDelegation,
      confirmDelegation,
      CLASS_DECIDERS,
    } = await gateClass();
    const d = confirmDelegation(proposeDelegation(GENERAL_DELEGATIONS[0]));
    for (const g of IRREVERSIBLE_GUARDS) {
      const decoy: GateDescriptor = {
        id: `decoy_${g.id}`,
        gateClass: "mechanical",
        decider: CLASS_DECIDERS.mechanical,
        summary: IRREVERSIBLE_SAMPLES[g.id]!,
      };
      const others = IRREVERSIBLE_GUARDS.filter((x) => x.id !== g.id);
      expect(others.length).toBe(IRREVERSIBLE_GUARDS.length - 1);
      expect(delegationCovers(d, decoy), `${g.id}: guard did not override`).toBe(false);
      expect(
        delegationCovers(d, decoy, { guards: others }),
        `${g.id}: dropping the guard changed nothing — the guard is inert`,
      ).toBe(true);
    }
  });

  test("a guard overrides a declared class even with the FULL guard set", async () => {
    const { classifyGate, CLASS_DECIDERS } = await gateClass();
    const decoy: GateDescriptor = {
      id: "decoy_merge",
      gateClass: "mechanical",
      decider: CLASS_DECIDERS.mechanical,
      summary: IRREVERSIBLE_SAMPLES.merge!,
    };
    expect(classifyGate(decoy)).toBe("irreversible");
  });

  test("with EVERY guard dropped, the decoys all become coverable — the floor is not the registry", async () => {
    // The complement of the drop-one legs: proves the exclusion, not some
    // unrelated fail-closed default, is what refuses the decoys.
    const { IRREVERSIBLE_GUARDS, delegationCovers, proposeDelegation, confirmDelegation, CLASS_DECIDERS } =
      await gateClass();
    const d = confirmDelegation(proposeDelegation(GENERAL_DELEGATIONS[0]));
    for (const g of IRREVERSIBLE_GUARDS) {
      const decoy: GateDescriptor = {
        id: `decoy_${g.id}`,
        gateClass: "mechanical",
        decider: CLASS_DECIDERS.mechanical,
        summary: IRREVERSIBLE_SAMPLES[g.id]!,
      };
      expect(delegationCovers(d, decoy, { guards: [] })).toBe(true);
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
  const root = mkdtempSync(join(tmpdir(), "delegation-exclusion-"));
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, "plugins", "dev-process-toolkit", rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, body);
  }
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const ANCHOR_FALLBACK = "standing authorization";

function compliantCarrier(anchor: string, phrases: string[]): string {
  return [
    "---",
    "name: fixture-skill",
    "---",
    "",
    "# Fixture Skill",
    "",
    `A ${anchor} delegates the mechanical class only. It never covers`,
    `${phrases.join(", ")} — those need a fresh instruction naming the action.`,
    "",
  ].join("\n");
}

describe("AC-STE-493.6 — the probe is non-vacuous in BOTH directions", () => {
  test("the module exports its probe id under the registered name", async () => {
    const { PROBE_ID } = await probeModule();
    expect(PROBE_ID).toBe(PROBE_ID_EXPECTED);
  });

  test("the probe's required phrases ARE the guards' action phrases — no drift", async () => {
    // Anti-drift pin: a sixth guard that the probe does not demand in prose
    // would let the shipped documentation and the shipped exclusion disagree.
    const { requiredExclusionPhrases } = await probeModule();
    const { IRREVERSIBLE_GUARDS } = await gateClass();
    expect(requiredExclusionPhrases().sort()).toEqual(
      IRREVERSIBLE_GUARDS.map((g) => g.actionPhrase).sort(),
    );
  });

  test("a carrier naming every excluded action ⇒ zero violations", async () => {
    const { runDelegationIrreversibleExclusionProbe, requiredExclusionPhrases } =
      await probeModule();
    const { DELEGATION_ANCHOR } = await gateClass();
    const fx = makeFixture({
      "skills/fixture-skill/SKILL.md": compliantCarrier(
        DELEGATION_ANCHOR,
        requiredExclusionPhrases(),
      ),
    });
    try {
      const r = await runDelegationIrreversibleExclusionProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("a carrier missing ONE excluded action ⇒ at least one violation, per action", async () => {
    // Per-phrase mutation: each phrase in turn is removed from an otherwise
    // compliant carrier, and each removal must be detected on its own.
    const { runDelegationIrreversibleExclusionProbe, requiredExclusionPhrases } =
      await probeModule();
    const { DELEGATION_ANCHOR } = await gateClass();
    const phrases = requiredExclusionPhrases();
    expect(phrases.length).toBeGreaterThanOrEqual(5);
    for (const missing of phrases) {
      const kept = phrases.filter((p) => p !== missing);
      expect(kept.length).toBe(phrases.length - 1); // mutation applied
      const body = compliantCarrier(DELEGATION_ANCHOR, kept);
      expect(body).not.toContain(missing);
      const fx = makeFixture({ "skills/fixture-skill/SKILL.md": body });
      try {
        const r = await runDelegationIrreversibleExclusionProbe(fx.root);
        expect(
          r.violations.length,
          `dropping "${missing}" produced no violation`,
        ).toBeGreaterThanOrEqual(1);
        expect(r.violations[0]!.reason).toContain(missing);
      } finally {
        fx.cleanup();
      }
    }
  });

  test("the violation carries the NFR-10 canonical shape", async () => {
    const { runDelegationIrreversibleExclusionProbe } = await probeModule();
    const { DELEGATION_ANCHOR } = await gateClass();
    const fx = makeFixture({
      "skills/fixture-skill/SKILL.md": compliantCarrier(DELEGATION_ANCHOR, []),
    });
    try {
      const r = await runDelegationIrreversibleExclusionProbe(fx.root);
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

  test("SCOPE GUARD: a file that never names a standing authorization is out of scope", async () => {
    // Without this the probe would demand the exclusion prose of every file in
    // the tree — a false red on nearly all of them.
    const { runDelegationIrreversibleExclusionProbe } = await probeModule();
    const fx = makeFixture({
      "skills/plain-skill/SKILL.md": "---\nname: plain\n---\n\n# Plain\n\nNothing here.\n",
      "docs/plain-doc.md": "# Plain doc\n\nNo delegation vocabulary at all.\n",
    });
    try {
      const r = await runDelegationIrreversibleExclusionProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("docs carriers are in scope too — the exclusion cannot be documented away in docs/", async () => {
    const { runDelegationIrreversibleExclusionProbe } = await probeModule();
    const { DELEGATION_ANCHOR } = await gateClass();
    const fx = makeFixture({
      "docs/fixture-reference.md": compliantCarrier(DELEGATION_ANCHOR, []),
    });
    try {
      const r = await runDelegationIrreversibleExclusionProbe(fx.root);
      expect(r.violations.length).toBeGreaterThanOrEqual(1);
      expect(r.violations[0]!.note).toContain("fixture-reference.md");
    } finally {
      fx.cleanup();
    }
  });

  test("VACUOUS: no plugin tree at all ⇒ zero violations, no crash", async () => {
    const { runDelegationIrreversibleExclusionProbe } = await probeModule();
    const fx = makeFixture({});
    try {
      const r = await runDelegationIrreversibleExclusionProbe(fx.root);
      expect(r.violations).toEqual([]);
    } finally {
      fx.cleanup();
    }
  });

  test("the probe is clean on this repository", async () => {
    const { runDelegationIrreversibleExclusionProbe } = await probeModule();
    const r = await runDelegationIrreversibleExclusionProbe(REPO_ROOT);
    expect(r.violations.map((v) => v.note)).toEqual([]);
  });

  test("this repository is a real subject — /deliver IS a carrier", async () => {
    // A clean probe over a tree with no carriers is vacuous. The shipped
    // /deliver SKILL.md must carry the anchor, so the clean result above is
    // evidence rather than absence.
    const { DELEGATION_ANCHOR } = await gateClass();
    expect(DELEGATION_ANCHOR.length).toBeGreaterThan(0);
    expect(skillBody("deliver")).toContain(DELEGATION_ANCHOR);
  });

  test("the anchor is the vocabulary the FR names", async () => {
    const { DELEGATION_ANCHOR } = await gateClass();
    expect(DELEGATION_ANCHOR).toBe(ANCHOR_FALLBACK);
  });
});

describe("AC-STE-493.6 — the probe is registered in /gate-check", () => {
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
    expect(row).toContain(
      "adapters/_shared/src/delegation_irreversible_exclusion.ts",
    );
    expect(row).toContain(
      "runDelegationIrreversibleExclusionProbe(projectRoot)",
    );
    expect(row).toContain("Severity: error");
    expect(row).toContain("tests/m129-ste-493-gate-class.test.ts");
  });

  test("the row does not displace probe #77", () => {
    // A registration that renumbers an existing row breaks every pin that
    // names it. #77 stays where M126 put it.
    const row77 = rowsFor(77);
    expect(row77.length).toBe(1);
    expect(row77[0]!).toContain("`first_turn_refusal_marker`");
  });

  test("both shared modules exist on disk under their pinned paths", () => {
    expect(existsSync(GATE_CLASS_MODULE_FILE)).toBe(true);
    expect(existsSync(PROBE_MODULE_FILE)).toBe(true);
  });
});

// ===========================================================================
// AC-STE-493.7 — distinct from the auto-approve marker.
// ===========================================================================

describe("AC-STE-493.7 — the delegation mechanism is not the auto-approve marker", () => {
  test("the marker literal is sourced from the shipped module, not retyped", () => {
    // Guard on the sourcing itself: if the extraction ever silently returns
    // something that is not the marker, every pin below would be scoring the
    // wrong subject.
    expect(AUTO_APPROVE_MARKER.startsWith("<dpt:auto-approve>")).toBe(true);
    expect(AUTO_APPROVE_MARKER.endsWith("</dpt:auto-approve>")).toBe(true);
  });

  test("the gate-class module never emits the marker", () => {
    expect(read(GATE_CLASS_MODULE_FILE)).not.toContain(AUTO_APPROVE_MARKER);
  });

  test("no carried kickoff text carries the marker", async () => {
    const { proposeDelegation, confirmDelegation, carryDelegation } =
      await gateClass();
    for (const text of GENERAL_DELEGATIONS) {
      const d = confirmDelegation(proposeDelegation(text));
      expect(d.restatement).not.toContain(AUTO_APPROVE_MARKER);
      expect(carryDelegation(BASE_KICKOFF, d)).not.toContain(AUTO_APPROVE_MARKER);
    }
    expect(carryDelegation(BASE_KICKOFF, null)).not.toContain(AUTO_APPROVE_MARKER);
  });

  test("NON-VACUITY: the same assertion fails on text that DOES carry the marker", () => {
    // Proves the three pins above can go red. A `not.toContain` on a literal
    // nothing ever contains is not evidence.
    const poisoned = `${BASE_KICKOFF}\n${AUTO_APPROVE_MARKER}\n`;
    expect(poisoned).toContain(AUTO_APPROVE_MARKER);
  });

  test("/deliver's marker prohibitions survive this FR's edit", () => {
    const body = skillBody("deliver");
    expect(body).toContain(AUTO_APPROVE_MARKER);
    expect(body).toContain("never injects the auto-approve marker");
    expect(body).toContain("never** carries the auto-approve marker");
  });

  test("/deliver states that the delegation is NOT the marker", async () => {
    const { DELEGATION_ANCHOR } = await gateClass();
    const body = skillBody("deliver");
    const lines = body.split("\n");
    const stated = lines.some(
      (l) =>
        (l.includes(DELEGATION_ANCHOR) || /delegat/i.test(l)) &&
        /auto-approve/.test(l) &&
        /(distinct|not the|never)/i.test(l),
    );
    expect(
      stated,
      "no line distinguishes the standing authorization from the auto-approve marker",
    ).toBe(true);
  });

  test("the auto-approve marker probe stays clean on this repository", async () => {
    // The shipped invariant this FR must not disturb: prompt-bearing spawn
    // fences keep their marker, and nothing else acquires one.
    const r = await runAutoApproveMarkerProbe(REPO_ROOT);
    expect(r.violations.map((v) => v.note)).toEqual([]);
  });
});

// ===========================================================================
// AC-STE-493.8 — the STE-313 supersession argument, in the FR body.
// ===========================================================================

/**
 * The three claims AC-STE-493.8 requires in writing. Factored so BOTH the live
 * FR body and a stripped copy run through the same predicate — a pin whose
 * predicate is never shown to fail is not a pin.
 */
function missingSupersessionClaims(body: string): string[] {
  const missing: string[] = [];
  if (!body.includes("STE-313")) missing.push("names STE-313");
  if (!/STE-313[\s\S]{0,400}?governs headless runs/.test(body)) {
    missing.push("STE-313 governs headless runs");
  }
  if (!/refuses?[^.]{0,40}non-tty|hard-refuses under non-tty/.test(body)) {
    missing.push("/deliver refuses non-tty unconditionally");
  }
  if (!/no carve-out|unconditional/i.test(body)) {
    missing.push("the refusal is unconditional");
  }
  if (!/disjoint/i.test(body)) missing.push("the two domains are disjoint");
  if (!/typed the words|typed them|live (human|operator)/i.test(body)) {
    missing.push("a live operator typed the words");
  }
  return missing;
}

describe("AC-STE-493.8 — the FR records why this does not weaken STE-313", () => {
  test("the FR body carries every claim the AC requires", () => {
    expect(missingSupersessionClaims(read(frPath()))).toEqual([]);
  });

  test("NON-VACUITY: the predicate rejects a body with the argument stripped", () => {
    const stripped = read(frPath())
      .split("\n")
      .filter((l) => !l.includes("STE-313"))
      .join("\n");
    const missing = missingSupersessionClaims(stripped);
    expect(missing).toContain("names STE-313");
    expect(missing).toContain("STE-313 governs headless runs");
  });

  test("NON-VACUITY: dropping the disjointness sentence is detected on its own", () => {
    const body = read(frPath());
    const stripped = body.replace(/disjoint/g, "related");
    expect(stripped).not.toContain("disjoint"); // mutation applied
    expect(missingSupersessionClaims(stripped)).toContain(
      "the two domains are disjoint",
    );
  });

  test("the argument lives in the FR, not only in the commit message or a review thread", () => {
    // The plan's mitigation for the "reviewer correctly kills the change" risk
    // is specifically that the argument is in the FR file.
    const body = read(frPath());
    const idx = body.indexOf("## Technical Design");
    expect(idx).toBeGreaterThan(0);
    expect(missingSupersessionClaims(body.slice(idx))).toEqual([]);
  });

  test("/deliver's own unconditional non-tty refusal is still shipped", async () => {
    // The load-bearing half of the argument, asserted against the surface it
    // claims about rather than the claim itself: if /deliver ever gained a
    // non-tty carve-out, the supersession argument would be false.
    const body = skillBody("deliver");
    expect(body).toContain("There is no marker carve-out");
    expect(body).toContain("the refusal is unconditional");
  });
});

// ---------------------------------------------------------------------------
// AC-STE-493.5/.6 — the push guard is VERB-ONLY, and stays that way.
//
// Found by the STE-493 audit: `push_to_trunk` originally required
// `trunk|main|master` to appear after the verb, so "push to origin", "push the
// tag" and "force-push the branch" were NOT caught — a delegation would have
// silently covered them. It was the only guard whose misses fell on the unsafe
// side; every sibling is verb-only and fails closed-broad.
//
// These legs pin the widening. Restoring the narrow form must go RED.
// ---------------------------------------------------------------------------

describe("AC-STE-493.6 — the push guard fails closed-BROAD, like its siblings", () => {
  const PUSH_PHRASINGS = [
    "push to origin",
    "push the tag",
    "force-push the branch",
    "push the release commit to trunk",
    "pushing the built artifact upstream",
  ];

  // These go through the GUARD-DRIVEN entry points on purpose. An earlier
  // draft asserted delegationCovers() against an ad-hoc unregistered gate
  // object — which returns false for ANY unregistered gate, benign or not, so
  // the legs passed even with the push guard removed entirely. That was a
  // perfect pin on the wrong subject; these read the classifier that actually
  // evaluates the text.
  for (const phrasing of PUSH_PHRASINGS) {
    test(`${JSON.stringify(phrasing)} classifies as irreversible`, async () => {
      const { isIrreversibleGate, classifyGate } = await gateClass();
      const asMechanical = { id: "adhoc", cls: "mechanical", summary: phrasing };
      expect({
        phrasing,
        guarded: isIrreversibleGate(asMechanical as never),
        cls: classifyGate(asMechanical as never),
      }).toEqual({ phrasing, guarded: true, cls: "irreversible" });
    });
  }

  // The declared class must not be able to launder it: a gate CLAIMING to be
  // mechanical while naming a push is still irreversible.
  test("a gate declaring itself mechanical cannot launder a push", async () => {
    const { classifyGate } = await gateClass();
    expect(
      classifyGate({ id: "x", cls: "mechanical", summary: "push the tag" } as never),
    ).toBe("irreversible");
  });

  // ISOLATION — the widening must not swallow everything. A mechanical gate
  // that names no irreversible action is still covered, or the leg above would
  // pass vacuously as "delegation covers nothing".
  // ISOLATION — the widening must not swallow everything. A REGISTERED
  // mechanical gate that names no irreversible action is still covered, or the
  // legs above would pass vacuously as "delegation covers nothing".
  test("ISOLATION: registered mechanical gates naming no push ARE still covered", async () => {
    const { confirmDelegation, proposeDelegation, delegationCovers, gateFor } =
      await gateClass();
    const delegation = confirmDelegation(
      proposeDelegation("drive it yourself, stop asking me"),
    );
    for (const id of MECHANICAL_GATE_IDS) {
      expect(delegationCovers(delegation, gateFor(id)!), `gate ${id}`).toBe(true);
    }
  });

  // BEHAVIOURAL, not source-inspecting: `matches` is a closure over the regex,
  // so its .toString() carries no pattern. Restoring the narrow
  // `push …(trunk|main|master)` form makes every phrasing below go false.
  test("the push guard itself matches the phrasings the narrow form missed", async () => {
    const { IRREVERSIBLE_GUARDS } = await gateClass();
    const push = IRREVERSIBLE_GUARDS.find((g) => g.id === "push_to_trunk");
    expect(push, "no push_to_trunk guard").toBeDefined();
    for (const phrasing of PUSH_PHRASINGS) {
      expect({ phrasing, hit: push!.matches(phrasing) }).toEqual({
        phrasing,
        hit: true,
      });
    }
    // And it still does not fire on prose naming no push at all.
    expect(push!.matches("confirm the next milestone number")).toBe(false);
  });
});

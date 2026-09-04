// M143 STE-552 — chain-continuation prompts are REGISTERED, so a standing
// authorization can reach them, and opening a pull request is GUARDED, so it
// never becomes reachable that way.
//
// WHAT IS BROKEN, measured on this tree 2026-09-04.
//
//   * `GATE_REGISTRY` holds nine entries and not one of them is a
//     chain-continuation prompt, so every one of them resolves through
//     `classifyGateWith`'s unknown-gate fallback — `content`, the class no
//     standing authorization reaches. The prompts are undelegable by OMISSION.
//   * `IRREVERSIBLE_GUARDS` holds five guards and NONE of them catches
//     "open a pull request", "open the PR", "Open a PR for this milestone?" or
//     the shipped ceremony prompt "Open ceremony PR via /pr now? (y/n):".
//     Only "push the branch and open the PR" is caught, and then solely on the
//     word `push`. Registering the ceremony-PR prompt mechanical would
//     therefore PASS AC.5's guard check today precisely because the gap
//     exists — which is why the guard lands FIRST and the ceremony-PR prompt is
//     never registered at all.
//
// TEST STRATEGY — what each leg is doing that a weaker one would not.
//
//   * THE SET IS DERIVED, NOT RETYPED. Which prompts get registered is read off
//     `CONTINUATION_OFFERS` (STE-551): an offer the surface EXECUTES on accept
//     (`runsWhenAccepted` non-empty) is a question with an answer; the three
//     that merely PRINT a `Next:` line are not prompts and have nothing to
//     delegate. The derived set is then pinned against a frozen literal, so a
//     change to the STE-551 registry reddens this file rather than silently
//     widening or narrowing this FR's scope.
//   * A GATE ID IS ITS OFFER ID. One namespace, so the two registries cannot
//     drift into naming the same prompt two things.
//   * AC.1 ASSERTS THE LOOKUP AND THE VERDICT. `gateFor` non-null proves
//     registration; `classifyGate === "mechanical"` proves the declared class;
//     and a MODULE-COPY MUTATION of the unknown-gate fallback proves the
//     verdict comes from the registry and not from the fallback happening to
//     agree. The unregistered control is what proves the mutation applied.
//   * AC.3 IS SCORED BY RUNNING THE SHIPPED SUITES, not by review. The two
//     files whose pins this FR is allowed to move are executed in a
//     subprocess and must report the SAME test count and zero failures. A
//     third pin moving shows up as a red there, which is the only mechanical
//     way to grade "exactly two pins move".
//   * AC.7 IS A REAL DROP-ONE. The entry is de-registered in a copy of
//     `gate_class.ts` — not simulated with a lookalike id — and the mutant is
//     imported and asked the same questions.
//
// `gate_class.ts` imports nothing, so a mutated copy is a single importable
// file; the harness below is the one `tests/m133-ste-515-gate-registration.test.ts`
// established.

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CLASS_DECIDERS,
  GATE_REGISTRY,
  IRREVERSIBLE_GUARDS,
  classifyGate,
  confirmDelegation,
  delegationCovers,
  gateFor,
  isIrreversibleGate,
  proposeDelegation,
  relayRequired,
} from "../adapters/_shared/src/gate_class";
import type {
  Delegation,
  GateClass,
  GateDescriptor,
  IrreversibleGuard,
} from "../adapters/_shared/src/gate_class";
import { CONTINUATION_OFFERS } from "../adapters/_shared/src/continuation_offer";
import {
  requiredExclusionPhrases,
  runDelegationIrreversibleExclusionProbe,
} from "../adapters/_shared/src/delegation_irreversible_exclusion";

// ===========================================================================
// Paths + the subject.
// ===========================================================================

const PLUGIN_ROOT = join(import.meta.dir, "..");
const REPO_ROOT = join(PLUGIN_ROOT, "..", "..");
const GATE_CLASS_FILE = join(
  PLUGIN_ROOT,
  "adapters",
  "_shared",
  "src",
  "gate_class.ts",
);
const GATE_CLASS_SOURCE = readFileSync(GATE_CLASS_FILE, "utf-8");

// ===========================================================================
// The set this FR registers — derived from STE-551's shipped offer registry,
// then pinned.
// ===========================================================================

/**
 * The one ask-shaped offer this FR deliberately does NOT register. Its ask
 * names an irreversible action, and AC.8's guard is what makes that true
 * rather than merely asserted.
 */
const CEREMONY_PR_OFFER_ID = "ship_milestone_ceremony_pr";

/**
 * ASK-SHAPED = the surface runs a chain step when the offer is accepted. The
 * other three shipped closes only PRINT the next command for a human to type;
 * nobody answers them, so there is no gate there to classify.
 */
const ASK_SHAPED_OFFER_IDS = CONTINUATION_OFFERS.filter(
  (o) => o.runsWhenAccepted.length > 0,
).map((o) => o.id);

const NEW_GATE_IDS = ASK_SHAPED_OFFER_IDS.filter(
  (id) => id !== CEREMONY_PR_OFFER_ID,
);

/**
 * The frozen expectation. Retyped on purpose: comparing the derivation to
 * itself would pass however badly `CONTINUATION_OFFERS` drifted.
 */
const EXPECTED_NEW_GATE_IDS = [
  "brainstorm_start_now",
  "implement_ship_ready_close",
  "implement_phase5_close",
] as const;

/** The class every newly registered prompt declares. */
const EXPECTED_NEW_CLASS: GateClass = "mechanical";

/** AC.6 — an absolute pin, not a "grew by" check. 9 shipped + 3 new. */
const PRE_FR_REGISTRY_SIZE = 9;
const EXPECTED_REGISTRY_SIZE = PRE_FR_REGISTRY_SIZE + EXPECTED_NEW_GATE_IDS.length;

// ===========================================================================
// AC.8 — the open_pr guard.
// ===========================================================================

const OPEN_PR_GUARD_ID = "open_pr";

/** AC.8's own count pin, moving with the guard exactly as AC.6's does. */
const EXPECTED_GUARD_COUNT = 6;

/** The shipped ceremony prompt, read off the STE-551 registry, not retyped. */
const CEREMONY_PR_ANCHOR = CONTINUATION_OFFERS.find(
  (o) => o.id === CEREMONY_PR_OFFER_ID,
)?.anchor;

/**
 * Every phrasing measured UNGUARDED on this tree before this FR. The last one
 * has no determiner after `open`, so a regex demanding one misses the real
 * shipped prompt while passing the three synthetic ones.
 */
const PR_PHRASINGS: readonly string[] = [
  "open a pull request",
  "open the PR",
  "Open a PR for this milestone?",
  "Open ceremony PR via /pr now? (y/n):",
];

/**
 * The drop-one isolation sample: exactly one guard may catch it, or dropping
 * that guard leaves another standing and the mutation proves nothing.
 */
const OPEN_PR_SAMPLE = "open a pull request for the milestone";

/** The three shipped carriers probe #78 derives its required phrases for. */
const DELEGATION_CARRIERS: readonly string[] = [
  join(PLUGIN_ROOT, "skills", "deliver", "SKILL.md"),
  join(PLUGIN_ROOT, "skills", "gate-check", "SKILL.md"),
  join(PLUGIN_ROOT, "docs", "deliver-reference.md"),
];

/** NFR-1's shipped SKILL.md ceiling. Two carriers are skills and near it. */
const SKILL_LINE_CAP = 358;

// ===========================================================================
// AC.3 — the shipped suites this FR is allowed to touch, and the ONLY two.
// ===========================================================================

const SHIPPED_SUITES = [
  "tests/m129-ste-493-gate-class.test.ts",
  "tests/m133-ste-515-gate-registration.test.ts",
] as const;

/**
 * Measured on this tree BEFORE the pin moves: `bun test` over both files
 * reported `117 pass / 0 fail`. The pin moves rewrite literals inside existing
 * tests and add no `test()` blocks, so the count is an invariant: a changed
 * count means a test was added, removed or renamed away — i.e. a third pin
 * moved — even if the run is green.
 */
const SHIPPED_SUITE_TEST_COUNT = 117;

// ===========================================================================
// Delegation helpers.
// ===========================================================================

/** An operator statement that IS a standing authorization. */
const STANDING_AUTHORIZATION = "drive the mechanics yourself";

function activeDelegation(): Delegation {
  const proposed = proposeDelegation(STANDING_AUTHORIZATION);
  expect(proposed.active, "a proposed delegation must not be active").toBe(false);
  const confirmed = confirmDelegation(proposed);
  expect(confirmed.active, "confirmDelegation did not put it on the record").toBe(
    true,
  );
  return confirmed;
}

function decoy(id: string, summary: string): GateDescriptor {
  return {
    id,
    gateClass: EXPECTED_NEW_CLASS,
    decider: CLASS_DECIDERS[EXPECTED_NEW_CLASS],
    summary,
  };
}

// ===========================================================================
// The module-copy mutation harness (the m133 pattern; Bun's module cache keys
// on the resolved path, so every variant gets its own directory).
// ===========================================================================

interface GateClassModule {
  GATE_REGISTRY: readonly GateDescriptor[];
  IRREVERSIBLE_GUARDS: readonly IrreversibleGuard[];
  classifyGate(gate: string | GateDescriptor): GateClass;
  gateFor(id: string): GateDescriptor | null;
  relayRequired(gate: string | GateDescriptor, d: Delegation | null): boolean;
  delegationCovers(d: string | Delegation | null, gate: string | GateDescriptor): boolean;
}

const scratchDirs: string[] = [];

async function loadVariant(
  label: string,
  source: string,
): Promise<GateClassModule> {
  const dir = mkdtempSync(join(tmpdir(), `ste552-${label}-`));
  scratchDirs.push(dir);
  const file = join(dir, "gate_class.ts");
  writeFileSync(file, source);
  return (await import(file)) as unknown as GateClassModule;
}

function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** The unknown-gate fallback AC.1's discrimination leg rewrites. */
const FALLBACK_ANCHOR = 'return "content";';
const FALLBACK_MUTANT = 'return "irreversible";';

function mutateFallback(source: string): string {
  expect(
    occurrences(source, FALLBACK_ANCHOR),
    `the unknown-gate fallback anchor ${FALLBACK_ANCHOR} is not unique`,
  ).toBe(1);
  const mutated = source.replace(FALLBACK_ANCHOR, FALLBACK_MUTANT);
  expect(mutated, "fallback mutation did not apply").not.toBe(source);
  return mutated;
}

/**
 * AC.7's drop-one: rename one registration's id so the prompt is no longer
 * registered. Syntax untouched — only the id string moves — and the mutant is
 * asked for `gateFor(id)` afterwards, so a mutation that silently failed to
 * apply cannot read as a pass.
 */
function deregister(source: string, id: string): string {
  const quoted = `"${id}"`;
  expect(
    occurrences(source, quoted),
    `expected a quoted registration of ${id} in gate_class.ts`,
  ).toBeGreaterThanOrEqual(1);
  const mutated = source.split(quoted).join(`"${id}__deregistered"`);
  expect(mutated, `de-registration of ${id} did not apply`).not.toBe(source);
  return mutated;
}

function openPrGuard(): IrreversibleGuard {
  const g = IRREVERSIBLE_GUARDS.find((x) => x.id === OPEN_PR_GUARD_ID);
  expect(
    g,
    `IRREVERSIBLE_GUARDS has no ${OPEN_PR_GUARD_ID} guard — opening a PR is unguarded`,
  ).toBeDefined();
  return g!;
}

// ===========================================================================
// AC-STE-552.1 — each chain-continuation prompt carries a registry entry, and
// `classifyGate` resolves it to the DECLARED class, not the fallback.
// ===========================================================================

describe("AC-STE-552.1 — the prompts are registered, not defaulted", () => {
  test("the registered set is exactly the ask-shaped offers minus the ceremony PR", () => {
    expect(
      NEW_GATE_IDS,
      "the set derived from CONTINUATION_OFFERS drifted from this FR's scope",
    ).toEqual([...EXPECTED_NEW_GATE_IDS]);
    expect(
      ASK_SHAPED_OFFER_IDS,
      "the ceremony-PR offer is ask-shaped and must be the one deliberate exclusion",
    ).toContain(CEREMONY_PR_OFFER_ID);
  });

  test("each prompt has a registry entry — the LOOKUP, not the verdict", () => {
    for (const id of NEW_GATE_IDS) {
      expect(gateFor(id), `${id} is not in GATE_REGISTRY`).not.toBeNull();
    }
  });

  test("each entry declares the mechanical class and carries that class's decider", () => {
    for (const id of NEW_GATE_IDS) {
      const g = gateFor(id)!;
      expect(g.gateClass, `${id} declares the wrong class`).toBe(EXPECTED_NEW_CLASS);
      expect(g.decider, `${id} carries a stale decider`).toBe(
        CLASS_DECIDERS[EXPECTED_NEW_CLASS],
      );
      expect(g.summary.trim().length, `${id} has an empty summary`).toBeGreaterThan(0);
      expect(g.summary, `${id}'s summary is just its id`).not.toBe(id);
    }
  });

  test("classifyGate answers the declared class — not content, not irreversible", () => {
    for (const id of NEW_GATE_IDS) {
      expect(classifyGate(id), `${id} did not resolve to its declared class`).toBe(
        EXPECTED_NEW_CLASS,
      );
      expect(classifyGate(id), `${id} fell through to the unknown-gate fallback`).not.toBe(
        "content",
      );
    }
  });

  test("DISCRIMINATION: mutating the fallback moves an unregistered id and NOT these", async () => {
    // A verdict that agrees with the fallback is not evidence of registration.
    // Rewrite the fallback in a module copy: the control MUST move (proof the
    // mutation applied and this test can see it) while every registered prompt
    // stays put.
    const mutant = await loadVariant("fallback", mutateFallback(GATE_CLASS_SOURCE));
    const control = "ste552_control_gate_nobody_registered";
    expect(mutant.gateFor(control), "the control must be unregistered").toBeNull();
    expect(mutant.classifyGate(control), "fallback mutation never applied").toBe(
      "irreversible",
    );
    for (const id of NEW_GATE_IDS) {
      expect(
        mutant.classifyGate(id),
        `${id} answers through the fallback, not the registry`,
      ).toBe(EXPECTED_NEW_CLASS);
    }
  });
});

// ===========================================================================
// AC-STE-552.2 — a delegation reaches each prompt; without one, each relays.
// ===========================================================================

describe("AC-STE-552.2 — relayRequired flips per prompt, both halves", () => {
  test("with an active delegation, each newly registered prompt stops relaying", () => {
    const d = activeDelegation();
    for (const id of NEW_GATE_IDS) {
      expect(
        relayRequired(id, d),
        `${id} still demands a relay under a standing authorization`,
      ).toBe(false);
      expect(delegationCovers(d, id), `${id} is not covered by the delegation`).toBe(
        true,
      );
    }
  });

  test("with no delegation on the record, each one relays — asserted per prompt", () => {
    for (const id of NEW_GATE_IDS) {
      expect(relayRequired(id, null), `${id} stopped relaying with no delegation`).toBe(
        true,
      );
      expect(delegationCovers(null, id), `${id} covered with no delegation`).toBe(false);
    }
  });

  test("a PROPOSED but unconfirmed delegation reaches none of them", () => {
    const proposed = proposeDelegation(STANDING_AUTHORIZATION);
    for (const id of NEW_GATE_IDS) {
      expect(relayRequired(id, proposed), `${id} answered to an unconfirmed scope`).toBe(
        true,
      );
    }
  });
});

// ===========================================================================
// AC-STE-552.3 — registration is INERT absent a delegation, and exactly two
// shipped identity pins move.
// ===========================================================================

describe("AC-STE-552.3 — an undelegated run is unchanged", () => {
  test("every registered gate — old and new — relays when nothing is on the record", () => {
    expect(GATE_REGISTRY.length).toBeGreaterThan(0);
    for (const g of GATE_REGISTRY) {
      expect(relayRequired(g, null), `${g.id} stopped relaying with no delegation`).toBe(
        true,
      );
      expect(relayRequired(g.id, null), `${g.id} (by id) stopped relaying`).toBe(true);
      expect(delegationCovers(null, g), `${g.id} covered with no delegation`).toBe(false);
    }
  });

  test(
    "the two shipped suites still pass, with the same test count — no third pin moved",
    () => {
      const run = spawnSync(
        "bun",
        ["test", ...SHIPPED_SUITES],
        { cwd: PLUGIN_ROOT, encoding: "utf-8" },
      );
      const out = `${run.stdout ?? ""}\n${run.stderr ?? ""}`;
      expect(run.status, `shipped suites did not pass:\n${out}`).toBe(0);
      const fails = out.match(/(\d+)\s+fail/);
      expect(fails, `no failure count in bun output:\n${out}`).not.toBeNull();
      expect(Number(fails![1]), `shipped suites reported failures:\n${out}`).toBe(0);
      const ran = out.match(/Ran (\d+) tests/);
      expect(ran, `no test count in bun output:\n${out}`).not.toBeNull();
      expect(
        Number(ran![1]),
        "the shipped suites' test count changed — a pin was added or removed, " +
          "not merely retargeted",
      ).toBe(SHIPPED_SUITE_TEST_COUNT);
    },
    120_000,
  );
});

// ===========================================================================
// AC-STE-552.4 — the irreversible guard still OVERRIDES a declared class.
// ===========================================================================

describe("AC-STE-552.4 — a guard overrides a declared mechanical class", () => {
  test("a discarded probe entry naming each guarded action resolves irreversible", () => {
    const d = activeDelegation();
    expect(IRREVERSIBLE_GUARDS.length).toBeGreaterThan(0);
    for (const g of IRREVERSIBLE_GUARDS) {
      // The guard's OWN operator-facing phrase is the summary, so this leg
      // widens automatically the day a guard is added or reworded.
      expect(g.matches(g.actionPhrase), `${g.id} does not catch its own phrase`).toBe(
        true,
      );
      const probe = decoy(`ste552_probe_${g.id}`, g.actionPhrase);
      expect(
        classifyGate(probe),
        `${g.id}: a mechanical declaration survived the guard`,
      ).toBe("irreversible");
      expect(
        delegationCovers(d, probe),
        `${g.id}: a standing authorization reached a guarded action`,
      ).toBe(false);
      expect(
        relayRequired(probe, d),
        `${g.id}: a guarded action stopped relaying under a delegation`,
      ).toBe(true);
    }
  });

  test("a prompt THIS FR registers cannot buy its way out by declaring mechanical", () => {
    // The override asserted on the entries this FR actually adds, not on a
    // synthetic id: each registered prompt's own id and declared class, with a
    // guarded summary swapped in. If registration could shield a summary from
    // the guards, this is where it would show.
    const d = activeDelegation();
    for (const id of NEW_GATE_IDS) {
      const registered = gateFor(id);
      expect(registered, `${id} is not registered`).not.toBeNull();
      expect(registered!.gateClass, `${id} is not the delegable class`).toBe(
        EXPECTED_NEW_CLASS,
      );
      for (const g of IRREVERSIBLE_GUARDS) {
        const reworded: GateDescriptor = {
          ...registered!,
          summary: g.actionPhrase,
        };
        expect(
          classifyGate(reworded),
          `${id} reworded to "${g.actionPhrase}" stayed ${EXPECTED_NEW_CLASS}`,
        ).toBe("irreversible");
        expect(
          relayRequired(reworded, d),
          `${id} reworded to "${g.actionPhrase}" stopped relaying`,
        ).toBe(true);
      }
    }
  });

  test("the probe entries are discarded — none of them is in the registry", () => {
    const ids = GATE_REGISTRY.map((g) => g.id);
    for (const g of IRREVERSIBLE_GUARDS) {
      expect(ids, `probe entry for ${g.id} was left in the registry`).not.toContain(
        `ste552_probe_${g.id}`,
      );
    }
  });
});

// ===========================================================================
// AC-STE-552.5 — no entry added here names a guarded action.
// ===========================================================================

describe("AC-STE-552.5 — no new summary trips any guard", () => {
  test("each new summary is run through EVERY guard and matches none", () => {
    for (const id of NEW_GATE_IDS) {
      const summary = gateFor(id)!.summary;
      for (const g of IRREVERSIBLE_GUARDS) {
        expect(
          g.matches(summary),
          `${id}'s summary "${summary}" trips the ${g.id} guard`,
        ).toBe(false);
      }
      expect(isIrreversibleGate(summary), `${id}'s summary is guarded`).toBe(false);
      expect(classifyGate(gateFor(id)!), `${id} was overridden by a guard`).toBe(
        EXPECTED_NEW_CLASS,
      );
    }
  });

  test("the ceremony-PR prompt is excluded BECAUSE it names a guarded action", () => {
    // The honesty check on AC.5: the exclusion is not a matter of taste. Once
    // the open_pr guard lands, the ceremony prompt is guarded and could not be
    // registered mechanical even if someone tried.
    expect(CEREMONY_PR_ANCHOR, "the ceremony-PR offer disappeared").toBeDefined();
    expect(CEREMONY_PR_ANCHOR).toBe("Open ceremony PR via /pr now? (y/n):");
    expect(
      isIrreversibleGate(CEREMONY_PR_ANCHOR!),
      "the ceremony-PR prompt is still unguarded",
    ).toBe(true);
    expect(
      GATE_REGISTRY.map((g) => g.id),
      "the ceremony-PR prompt must not be registered at all",
    ).not.toContain(CEREMONY_PR_OFFER_ID);
  });
});

// ===========================================================================
// AC-STE-552.6 — the count is PINNED, not merely grown.
// ===========================================================================

describe("AC-STE-552.6 — the registry's count assertion moves in step", () => {
  test("GATE_REGISTRY holds exactly the expected number of entries", () => {
    expect(
      GATE_REGISTRY.length,
      "the registry is not the size this FR pins — an entry was added or lost",
    ).toBe(EXPECTED_REGISTRY_SIZE);
  });

  test("the registry MINUS the new entries is still the pre-FR nine", () => {
    const others = GATE_REGISTRY.filter(
      (g) => !NEW_GATE_IDS.includes(g.id),
    );
    expect(others.length, "an unrelated entry was smuggled in").toBe(
      PRE_FR_REGISTRY_SIZE,
    );
  });

  test("every id is unique", () => {
    const ids = GATE_REGISTRY.map((g) => g.id);
    expect(new Set(ids).size, "duplicate gate id in the registry").toBe(ids.length);
  });
});

// ===========================================================================
// AC-STE-552.7 — falsifiability: drop one entry, that prompt reverts.
// ===========================================================================

describe("AC-STE-552.7 — every new entry is load-bearing, one at a time", () => {
  test("de-registering one prompt returns IT to the fallback and leaves its siblings", async () => {
    const d = activeDelegation();
    for (const id of NEW_GATE_IDS) {
      const mutant = await loadVariant(
        `drop-${id}`,
        deregister(GATE_CLASS_SOURCE, id),
      );
      // MUTATION APPLIED? Measured before any verdict is read.
      expect(mutant.gateFor(id), `${id}: de-registration did not apply`).toBeNull();
      expect(mutant.GATE_REGISTRY.length, `${id}: an entry vanished entirely`).toBe(
        EXPECTED_REGISTRY_SIZE,
      );

      expect(
        mutant.classifyGate(id),
        `${id}: unregistered, it must fall back to content`,
      ).toBe("content");
      expect(
        mutant.relayRequired(id, d),
        `${id}: unregistered, its delegated leg must require a relay again`,
      ).toBe(true);
      expect(
        mutant.delegationCovers(d, id),
        `${id}: unregistered, no delegation may cover it`,
      ).toBe(false);

      for (const sibling of NEW_GATE_IDS.filter((s) => s !== id)) {
        expect(
          mutant.classifyGate(sibling),
          `${id}: dropping it disturbed ${sibling}`,
        ).toBe(EXPECTED_NEW_CLASS);
        expect(
          mutant.relayRequired(sibling, d),
          `${id}: dropping it made ${sibling} relay again`,
        ).toBe(false);
      }
    }
  });
});

// ===========================================================================
// AC-STE-552.8 — opening a pull request gets a guard of its own.
// ===========================================================================

describe("AC-STE-552.8 — the open_pr guard", () => {
  test("IRREVERSIBLE_GUARDS carries an open_pr entry, and the count pin moves with it", () => {
    const g = openPrGuard();
    expect(g.actionPhrase.trim().length, "open_pr has no action phrase").toBeGreaterThan(
      0,
    );
    expect(g.reason.trim().length, "open_pr has no reason").toBeGreaterThan(10);
    expect(
      IRREVERSIBLE_GUARDS.length,
      "the guard count is not the number this FR pins",
    ).toBe(EXPECTED_GUARD_COUNT);
    expect(
      new Set(IRREVERSIBLE_GUARDS.map((x) => x.actionPhrase)).size,
      "two guards share an action phrase — that is one guard wearing two names",
    ).toBe(IRREVERSIBLE_GUARDS.length);
  });

  test("every phrasing measured UNGUARDED before this FR is now caught", () => {
    const g = openPrGuard();
    for (const phrase of PR_PHRASINGS) {
      expect(g.matches(phrase), `open_pr misses "${phrase}"`).toBe(true);
      expect(isIrreversibleGate(phrase), `"${phrase}" is still not irreversible`).toBe(
        true,
      );
    }
    // The real shipped prompt has NO determiner after `open`; a regex demanding
    // one passes the three synthetic phrasings and misses the only one that
    // ships.
    expect(g.matches(CEREMONY_PR_ANCHOR!), "open_pr misses the shipped prompt").toBe(
      true,
    );
  });

  test("the isolation sample is caught by EXACTLY ONE guard", () => {
    const hits = IRREVERSIBLE_GUARDS.filter((x) => x.matches(OPEN_PR_SAMPLE)).map(
      (x) => x.id,
    );
    expect(hits, "the open_pr sample is not isolated").toEqual([OPEN_PR_GUARD_ID]);
  });

  test("DROP-ONE: without open_pr the sample is no longer irreversible", () => {
    const others = IRREVERSIBLE_GUARDS.filter((x) => x.id !== OPEN_PR_GUARD_ID);
    expect(others.length, "the drop did not apply").toBe(
      IRREVERSIBLE_GUARDS.length - 1,
    );
    expect(isIrreversibleGate(OPEN_PR_SAMPLE), "sample not caught with the full set").toBe(
      true,
    );
    expect(
      isIrreversibleGate(OPEN_PR_SAMPLE, others),
      "open_pr is not load-bearing",
    ).toBe(false);
  });

  test("DROP-ONE at the public entry point: without open_pr a delegation reaches a PR prompt", () => {
    const d = activeDelegation();
    const others = IRREVERSIBLE_GUARDS.filter((x) => x.id !== OPEN_PR_GUARD_ID);
    const probe = decoy("ste552_probe_open_pr", CEREMONY_PR_ANCHOR!);
    expect(
      delegationCovers(d, probe),
      "a delegation reached a PR prompt with every guard in place",
    ).toBe(false);
    expect(
      delegationCovers(d, probe, { guards: others }),
      "dropping open_pr changed nothing at the public entry point",
    ).toBe(true);
  });

  test("OVERRIDE: a PR prompt declared mechanical resolves irreversible anyway", () => {
    const d = activeDelegation();
    for (const phrase of PR_PHRASINGS) {
      const probe = decoy("ste552_probe_pr_declared_mechanical", phrase);
      expect(
        classifyGate(probe),
        `"${phrase}" declared mechanical survived the guard`,
      ).toBe("irreversible");
      expect(relayRequired(probe, d), `"${phrase}" stopped relaying`).toBe(true);
    }
    // Discarded, like AC.4's: nothing here is registered.
    expect(GATE_REGISTRY.map((g) => g.id)).not.toContain(
      "ste552_probe_pr_declared_mechanical",
    );
  });

  test("probe #78's required phrases widen with the guard", () => {
    const phrases = requiredExclusionPhrases();
    expect(phrases.length, "the derived phrase list did not widen").toBe(
      EXPECTED_GUARD_COUNT,
    );
    expect(phrases, "open_pr's phrase is not required of a carrier").toContain(
      openPrGuard().actionPhrase,
    );
  });

  test("all three shipped delegation carriers name the new phrase verbatim", () => {
    const phrase = openPrGuard().actionPhrase;
    for (const file of DELEGATION_CARRIERS) {
      const body = readFileSync(file, "utf-8");
      expect(body, `${file} does not name "${phrase}"`).toContain(phrase);
    }
  });

  test("probe #78 is green against this repo", async () => {
    const r = await runDelegationIrreversibleExclusionProbe(REPO_ROOT);
    expect(
      r.violations,
      `probe #78 reds on the shipped carriers: ${JSON.stringify(r.violations)}`,
    ).toEqual([]);
  });

  test("the carrier edits stay under the shipped SKILL.md ceiling", () => {
    for (const file of DELEGATION_CARRIERS.filter((f) => f.endsWith("SKILL.md"))) {
      const lines = readFileSync(file, "utf-8").split("\n").length;
      expect(lines, `${file} broke the ${SKILL_LINE_CAP}-line cap`).toBeLessThanOrEqual(
        SKILL_LINE_CAP,
      );
    }
  });
});

// ===========================================================================
// Scratch cleanup.
// ===========================================================================

describe("harness hygiene", () => {
  test("every mutated module copy is removed", () => {
    for (const dir of scratchDirs) rmSync(dir, { recursive: true, force: true });
    expect(scratchDirs.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// AUDIT FOLLOW-UP (round 1, 2026-09-05) — the sweep no shipped leg performed.
//
// AC.5 runs THIS FR's summaries through the guards, deriving its subjects from
// CONTINUATION_OFFERS. That catches an EDIT to one of them and misses an
// ADDITION: a future mechanical entry added straight to the registry reds only
// the count pins, whose natural repair is to bump a number, after which nothing
// checks its summary. Runtime safety still holds — `classifyGate` overrides a
// mis-declared class — but the DETECTION gap is what lets a guarded prompt sit
// in the delegable block looking legitimate.
//
// This leg closes it over the whole registry rather than over this FR's three:
// every mechanical entry, every guard, no exceptions and no allowlist.
// ===========================================================================

describe("AUDIT FOLLOW-UP — no MECHANICAL registry entry names a guarded action", () => {
  test("every mechanical entry's summary is run through every guard", () => {
    const mechanical = GATE_REGISTRY.filter((g) => g.gateClass === "mechanical");
    // Not vacuous: the sweep has subjects, and it has more than this FR's three.
    expect(mechanical.length).toBeGreaterThanOrEqual(6);
    for (const gate of mechanical) {
      const hits = IRREVERSIBLE_GUARDS.filter((g) => g.matches(gate.summary));
      expect(
        hits.map((g) => g.id),
        `mechanical gate ${gate.id} names a guarded action: "${gate.summary}"`,
      ).toEqual([]);
      // And the class it resolves to is the class it declares — a guard hit
      // would silently move it, which is the override this leg exists beside.
      expect(classifyGate(gate.id)).toBe("mechanical");
    }
  });

  test("the sweep FAILS on a mechanical entry that names a guarded action", () => {
    // The control: without it, a sweep over a registry that happens to be clean
    // is indistinguishable from a sweep that cannot fail.
    const decoy: GateDescriptor = {
      id: "decoy_mechanical_pr",
      gateClass: "mechanical",
      decider: CLASS_DECIDERS.mechanical,
      summary: "confirm we create the pull request now",
    };
    const hits = IRREVERSIBLE_GUARDS.filter((g) => g.matches(decoy.summary));
    expect(hits.length).toBeGreaterThan(0);
    expect(classifyGate(decoy)).toBe("irreversible");
  });
});

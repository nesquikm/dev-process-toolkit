// M133 STE-515 — the resume confirm gate is REGISTERED, not merely defaulted.
//
// WHAT IS BROKEN, measured. `adapters/_shared/src/deliver_decision.ts` (shipped
// by STE-513 in this same milestone) names the pre-spawn chain-confirm gate:
//
//     export const CONFIRM_GATE = "deliver_chain_confirm";
//
// and prints two of its eight record fields from it — `gate_class` from
// `classifyGate(CONFIRM_GATE)` and `gate_relays` from
// `relayRequired(CONFIRM_GATE, null)`. That id appears NOWHERE in
// `GATE_REGISTRY` (`grep -c deliver_chain_confirm adapters/_shared/src/gate_class.ts`
// ⇒ 0), so both fields resolve through `classifyGateWith`'s third branch — the
// fallback for gates nobody has thought about — and are the constants
// `content` / `yes` for EVERY input. Two of eight fields carry no information.
//
// Right answer, no pin. The day the fallback changes, this gate changes class
// with it and nothing goes red.
//
// TEST STRATEGY, and why each half is not a tautology.
//
//   * THE ID IS NOT FREE. Every leg below keys on `CONFIRM_GATE` IMPORTED from
//     `deliver_decision`, never on a retyped literal. A registration under any
//     other id would leave the defect open while looking green, and this file
//     would go red for it.
//   * AC.2 ASSERTS THE LOOKUP, NOT THE VERDICT. `gateFor(CONFIRM_GATE)` is
//     asserted non-null directly, because `classifyGate` returns `content` for
//     a registered content gate AND for an unregistered one — the verdict
//     cannot tell registration from fallback and so is not evidence of it.
//   * AC.4 IS A DISCRIMINATION TEST, NOT A VERDICT TEST. Registering a gate
//     whose class already matches the fallback changes no verdict, so a
//     before/after comparison passes either way and proves nothing. The
//     discriminator is a MODULE-COPY MUTATION: `classifyGateWith`'s final
//     `return "content";` is rewritten to `return "mechanical";` in a copy of
//     the module, and the registered gate must NOT move while an UNREGISTERED
//     control id DOES. Both halves are required — the control is what proves
//     the mutation was applied and that this test can see it. A third variant
//     DE-REGISTERS the gate (its id renamed in the registry) and shows the same
//     mutation then moves it: that is the pre-FR state, reproduced.
//   * AC.6 IS A SWEEP GUARD. Editing a flat exported list is exactly where an
//     unrelated entry loses a character, so all eight pre-FR entries are pinned
//     byte-for-byte, in order, as a frozen literal — not read back out of the
//     module under test.
//
// `gate_class.ts` is a pure module with ZERO imports, which is why a mutated
// copy can be written to a scratch dir and imported directly rather than needing
// the passthrough-tree harness `tests/m133-ste-513-deliver-decision.test.ts`
// builds for its multi-import subject.

import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CLASS_DECIDERS,
  GATE_CLASSES,
  GATE_REGISTRY,
  classifyGate,
  confirmDelegation,
  delegationCovers,
  gateFor,
  isIrreversibleGate,
  proposeDelegation,
  relayRequired,
} from "../adapters/_shared/src/gate_class";
import type {
  GateClass,
  GateDescriptor,
} from "../adapters/_shared/src/gate_class";
import { CONFIRM_GATE } from "../adapters/_shared/src/deliver_decision";

// ===========================================================================
// Paths + the subject.
// ===========================================================================

const PLUGIN_ROOT = join(import.meta.dir, "..");
const GATE_CLASS_FILE = join(
  PLUGIN_ROOT,
  "adapters",
  "_shared",
  "src",
  "gate_class.ts",
);

const GATE_CLASS_SOURCE = readFileSync(GATE_CLASS_FILE, "utf-8");

/** The class no standing authorization reaches AND the fallback's own answer. */
const EXPECTED_CLASS: GateClass = "content";

/**
 * The fallback branch AC.4 mutates: `classifyGateWith`'s final return, the
 * branch meant for gates nobody has thought about.
 */
const FALLBACK_ANCHOR = `return "${EXPECTED_CLASS}";`;

/** What the mutation rewrites it to — any class that is not the real answer. */
const MUTANT_CLASS: GateClass = "mechanical";
const FALLBACK_MUTANT = `return "${MUTANT_CLASS}";`;

/**
 * An id nobody registers and no guard catches. It is the AC.4 control: under
 * the fallback mutation it MUST move, or the mutation never applied / this test
 * cannot see it, and the registered gate's stillness would testify to nothing.
 */
const UNREGISTERED_CONTROL = "ste515_control_gate_nobody_registered";

/** An operator statement that IS a standing authorization. */
const STANDING_AUTHORIZATION = "drive the mechanics yourself";

/** A registered MECHANICAL gate — the isolation partner for AC.5. */
const DELEGABLE_GATE = "milestone_number_choice";

// ===========================================================================
// AC.6's frozen literal — the eight entries that existed BEFORE this FR.
//
// Retyped here on purpose. Reading them back out of `GATE_REGISTRY` and
// comparing the module to itself would pass however badly the list were
// mangled; this is the byte-for-byte record a sweep has to survive.
// ===========================================================================

interface RegistryRow {
  readonly id: string;
  readonly gateClass: GateClass;
  readonly summary: string;
}

const PRE_FR_REGISTRY: readonly RegistryRow[] = [
  {
    id: "implement_commit_approval",
    gateClass: "content",
    summary: "approve the implementation diff before it is committed",
  },
  {
    id: "milestone_number_choice",
    gateClass: "mechanical",
    summary: "confirm the next milestone number the dispatcher already resolved",
  },
  {
    id: "branch_name_choice",
    gateClass: "mechanical",
    summary: "confirm the branch name the naming convention already determines",
  },
  {
    id: "tracker_write_prompt",
    gateClass: "mechanical",
    summary: "confirm a tracker field write for the item under work",
  },
  {
    id: "merge_pr",
    gateClass: "irreversible",
    summary: "merge the open pull request",
  },
  {
    id: "push_to_trunk",
    gateClass: "irreversible",
    summary: "push the release commit to trunk",
  },
  {
    id: "deploy",
    gateClass: "irreversible",
    summary: "deploy the built artifact to production",
  },
  {
    id: "publish",
    gateClass: "irreversible",
    summary: "publish the package to the registry",
  },
];

/**
 * PIN MOVED by M143 STE-552 (AC.6): the chain-continuation prompts registered
 * AFTER this FR. Named explicitly rather than filtered by class, so the sweep
 * guard below still catches an unrelated entry smuggled in on the same edit —
 * which is the whole reason that guard exists.
 */
const POST_FR_ADDED_IDS: readonly string[] = [
  "brainstorm_start_now",
  "implement_ship_ready_close",
  "implement_phase5_close",
];

const row = (g: GateDescriptor): RegistryRow => ({
  id: g.id,
  gateClass: g.gateClass,
  summary: g.summary,
});

// ===========================================================================
// The module-copy mutation harness.
//
// `gate_class.ts` imports nothing, so a mutated copy is a single file that can
// be imported on its own. Each variant gets a fresh directory because Bun's
// module cache keys on the resolved path.
// ===========================================================================

interface GateClassModule {
  GATE_REGISTRY: readonly GateDescriptor[];
  classifyGate(gate: string | GateDescriptor): GateClass;
  gateFor(id: string): GateDescriptor | null;
}

const scratchDirs: string[] = [];

function writeVariant(label: string, source: string): string {
  const dir = mkdtempSync(join(tmpdir(), `ste515-${label}-`));
  scratchDirs.push(dir);
  const file = join(dir, "gate_class.ts");
  writeFileSync(file, source);
  return file;
}

async function loadVariant(
  label: string,
  source: string,
): Promise<GateClassModule> {
  return (await import(writeVariant(label, source))) as unknown as GateClassModule;
}

/** Count non-overlapping occurrences of a plain substring. */
function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/**
 * Rewrite the unknown-gate fallback. The anchor is asserted UNIQUE and the
 * result asserted CHANGED before any verdict is read: the M126 lesson — a
 * mutation that never applied reads as a pass.
 */
function mutateFallback(source: string): string {
  expect(
    occurrences(source, FALLBACK_ANCHOR),
    `the unknown-gate fallback anchor ${FALLBACK_ANCHOR} is not unique in gate_class.ts`,
  ).toBe(1);
  const mutated = source.replace(FALLBACK_ANCHOR, FALLBACK_MUTANT);
  expect(mutated, "fallback mutation did not apply").not.toBe(source);
  expect(occurrences(mutated, FALLBACK_MUTANT)).toBeGreaterThanOrEqual(1);
  return mutated;
}

/**
 * Rename the confirm gate's registration so the id is no longer registered —
 * the pre-FR state, reproduced from the post-FR source. Syntax is untouched:
 * only the id string moves.
 */
function deregisterConfirmGate(source: string): string {
  const quoted = `"${CONFIRM_GATE}"`;
  expect(
    occurrences(source, quoted),
    `expected exactly one registration of ${CONFIRM_GATE} in gate_class.ts`,
  ).toBe(1);
  const mutated = source.replace(quoted, `"${CONFIRM_GATE}__deregistered"`);
  expect(mutated, "de-registration mutation did not apply").not.toBe(source);
  return mutated;
}

// ===========================================================================
// AC-STE-515.1 — the gate is a registered entry carrying the right class and a
// summary naming the action it gates.
// ===========================================================================

describe("AC-STE-515.1 — the confirm gate is a registered entry", () => {
  test("GATE_REGISTRY contains an entry whose id IS deliver_decision's CONFIRM_GATE", () => {
    // Keyed on the imported constant, never a retyped literal: a registration
    // under any other id leaves `deliver_decision`'s two fields on the fallback
    // while looking green.
    const ids = GATE_REGISTRY.map((g) => g.id);
    expect(ids, `no registry entry with id ${CONFIRM_GATE}`).toContain(
      CONFIRM_GATE,
    );
  });

  test("CANARY: the shipped id is still the string STE-513 committed", () => {
    // Cross-module contract. If STE-513's constant is renamed, the registry
    // must be renamed in the same commit — this names the string once so the
    // rename cannot happen silently on one side.
    expect(CONFIRM_GATE).toBe("deliver_chain_confirm");
  });

  test("the entry carries the class no standing authorization reaches", () => {
    const entry = GATE_REGISTRY.find((g) => g.id === CONFIRM_GATE);
    expect(entry, `gate ${CONFIRM_GATE} is not registered`).toBeDefined();
    expect(entry!.gateClass).toBe(EXPECTED_CLASS);
    expect([...GATE_CLASSES]).toContain(entry!.gateClass);
  });

  test("the entry's decider is its class's decider verbatim — no stale copy", () => {
    const entry = GATE_REGISTRY.find((g) => g.id === CONFIRM_GATE);
    expect(entry).toBeDefined();
    expect(entry!.decider).toBe(CLASS_DECIDERS[EXPECTED_CLASS]);
  });

  test("the summary names the action it gates — confirming the chain", () => {
    const entry = GATE_REGISTRY.find((g) => g.id === CONFIRM_GATE);
    expect(entry).toBeDefined();
    const summary = entry!.summary;
    expect(summary.trim().length).toBeGreaterThan(0);
    expect(summary.toLowerCase()).toContain("confirm");
    expect(summary.toLowerCase()).toContain("chain");
  });

  test("the summary trips NO irreversible guard", () => {
    // Guards run against the summary and OVERRIDE the declared class. A
    // summary wording that tripped one would silently reclassify this gate
    // `irreversible` and break AC.3 — this catches that at the wording.
    const entry = GATE_REGISTRY.find((g) => g.id === CONFIRM_GATE);
    expect(entry).toBeDefined();
    expect(isIrreversibleGate(entry!)).toBe(false);
    expect(isIrreversibleGate(CONFIRM_GATE)).toBe(false);
  });
});

// ===========================================================================
// AC-STE-515.2 — lookup, asserted directly.
// ===========================================================================

describe("AC-STE-515.2 — gateFor returns a descriptor, not null", () => {
  test("gateFor(CONFIRM_GATE) is a registered descriptor", () => {
    const descriptor = gateFor(CONFIRM_GATE);
    expect(
      descriptor,
      `gateFor(${CONFIRM_GATE}) returned null — the gate is not registered`,
    ).not.toBeNull();
    expect(descriptor!.id).toBe(CONFIRM_GATE);
  });

  test("NON-VACUITY: gateFor still returns null for an unregistered id", () => {
    // Without this leg, a `gateFor` that manufactured a descriptor for ANY
    // string would satisfy the pin above while registering nothing.
    expect(gateFor(UNREGISTERED_CONTROL)).toBeNull();
  });
});

// ===========================================================================
// AC-STE-515.3 — the shipped verdict is unchanged.
// ===========================================================================

describe("AC-STE-515.3 — classification is the same as before registration", () => {
  test("classifyGate(CONFIRM_GATE) is still content", () => {
    expect(classifyGate(CONFIRM_GATE)).toBe(EXPECTED_CLASS);
  });

  test("the descriptor classifies the same as the bare id", () => {
    const descriptor = gateFor(CONFIRM_GATE);
    expect(descriptor).not.toBeNull();
    expect(classifyGate(descriptor!)).toBe(classifyGate(CONFIRM_GATE));
  });
});

// ===========================================================================
// AC-STE-515.4 — the discrimination test. THE load-bearing leg.
// ===========================================================================

describe("AC-STE-515.4 — mutating the unknown-gate fallback does not move this gate", () => {
  test("PRECONDITION: unmutated, both the gate and the control read content", async () => {
    // The baseline the two mutant legs are read against. Both sides start
    // equal, which is precisely why the unmutated verdict proves nothing on
    // its own and the mutation is needed.
    const mod = await loadVariant("baseline", GATE_CLASS_SOURCE);
    expect(mod.classifyGate(CONFIRM_GATE)).toBe(EXPECTED_CLASS);
    expect(mod.classifyGate(UNREGISTERED_CONTROL)).toBe(EXPECTED_CLASS);
  });

  test("with the fallback mutated, the REGISTERED gate holds its class", async () => {
    const mod = await loadVariant("held", mutateFallback(GATE_CLASS_SOURCE));
    expect(
      mod.classifyGate(CONFIRM_GATE),
      `${CONFIRM_GATE} followed the mutated fallback — it is reading through ` +
        `branch 3, not through the registry`,
    ).toBe(EXPECTED_CLASS);
  });

  test("CONTROL: under the SAME mutation an unregistered gate DOES move", async () => {
    // This is what proves the mutation applied and that this test can see it.
    // Without it, the leg above would pass on a mutation that silently failed.
    const mod = await loadVariant("moved", mutateFallback(GATE_CLASS_SOURCE));
    expect(
      mod.classifyGate(UNREGISTERED_CONTROL),
      "the fallback mutation is invisible — the control did not move",
    ).toBe(MUTANT_CLASS);
  });

  test("PRE-FR STATE: de-registered, the same mutation moves the confirm gate", async () => {
    // The FR's claim, reproduced: before registration this gate followed the
    // fallback. De-register it in a copy and it moves with the control.
    const source = mutateFallback(deregisterConfirmGate(GATE_CLASS_SOURCE));
    const mod = await loadVariant("prefr", source);
    expect(mod.gateFor(CONFIRM_GATE)).toBeNull();
    expect(
      mod.classifyGate(CONFIRM_GATE),
      "de-registered AND fallback-mutated, the gate should follow the fallback",
    ).toBe(MUTANT_CLASS);
  });

  test("de-registered with the fallback INTACT, the gate still reads content — the accident", () => {
    // The exact state the FR describes: right answer, no pin. Asserted so the
    // leg above is understood to be measuring registration and not some
    // unrelated difference between the two copies.
    return loadVariant("accident", deregisterConfirmGate(GATE_CLASS_SOURCE)).then(
      (mod) => {
        expect(mod.gateFor(CONFIRM_GATE)).toBeNull();
        expect(mod.classifyGate(CONFIRM_GATE)).toBe(EXPECTED_CLASS);
      },
    );
  });
});

// ===========================================================================
// AC-STE-515.5 — relay behaviour, both sides of the reachability question.
// ===========================================================================

describe("AC-STE-515.5 — the gate relays, with and without a standing authorization", () => {
  test("with NO delegation on the record, the gate relays", () => {
    expect(relayRequired(CONFIRM_GATE, null)).toBe(true);
    expect(relayRequired(gateFor(CONFIRM_GATE)!, null)).toBe(true);
  });

  test("under a CONFIRMED standing authorization, the gate still relays", () => {
    const delegation = confirmDelegation(
      proposeDelegation(STANDING_AUTHORIZATION),
    );
    expect(delegation.active).toBe(true);
    expect(
      relayRequired(CONFIRM_GATE, delegation),
      `${CONFIRM_GATE} stopped relaying under a standing authorization`,
    ).toBe(true);
  });

  test("the same delegation does NOT cover this gate", () => {
    const delegation = confirmDelegation(
      proposeDelegation(STANDING_AUTHORIZATION),
    );
    expect(delegationCovers(delegation, CONFIRM_GATE)).toBe(false);
  });

  test("ISOLATION: that same delegation DOES silence a mechanical gate", () => {
    // Without this leg, "the confirm gate always relays" would be satisfied by
    // a module with no delegation mechanism at all.
    const delegation = confirmDelegation(
      proposeDelegation(STANDING_AUTHORIZATION),
    );
    expect(gateFor(DELEGABLE_GATE)).not.toBeNull();
    expect(delegationCovers(delegation, DELEGABLE_GATE)).toBe(true);
    expect(relayRequired(DELEGABLE_GATE, delegation)).toBe(false);
  });
});

// ===========================================================================
// AC-STE-515.6 — the sweep guard.
// ===========================================================================

describe("AC-STE-515.6 — the other registry entries are byte-identical", () => {
  test("every pre-FR entry is present with its exact id, class and summary", () => {
    for (const want of PRE_FR_REGISTRY) {
      const got = gateFor(want.id);
      expect(got, `pre-FR gate ${want.id} disappeared from the registry`).not.toBeNull();
      expect(row(got!), `pre-FR gate ${want.id} drifted`).toEqual(want);
    }
  });

  test("the registry MINUS the confirm gate is exactly the pre-FR list, in order", () => {
    // Catches deletion, reordering, and any unrelated addition smuggled in on
    // the same sweep — not just per-entry drift. STE-552's three named
    // additions are subtracted alongside the confirm gate; anything else is
    // still an unrelated addition and still reds this leg.
    const others = GATE_REGISTRY.filter(
      (g) => g.id !== CONFIRM_GATE && !POST_FR_ADDED_IDS.includes(g.id),
    ).map(row);
    expect(others).toEqual([...PRE_FR_REGISTRY]);
  });

  test("the registry grew by exactly one entry", () => {
    expect(GATE_REGISTRY.length).toBe(
      PRE_FR_REGISTRY.length + 1 + POST_FR_ADDED_IDS.length,
    );
  });

  test("the confirm gate is not one of the pre-FR ids under a new name", () => {
    expect(PRE_FR_REGISTRY.map((g) => g.id)).not.toContain(CONFIRM_GATE);
  });

  test("every pre-FR entry still classifies as it declares", () => {
    for (const want of PRE_FR_REGISTRY) {
      expect(classifyGate(want.id), `pre-FR gate ${want.id} reclassified`).toBe(
        want.gateClass,
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

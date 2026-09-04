// M143 STE-549 — a skill can tell whether an orchestrator is driving it.
//
// WHAT WAS BROKEN, measured on this tree. The toolkit had exactly one
// machine-checkable invocation signal: `<dpt:auto-approve>v1</dpt:auto-approve>`,
// read by `adapters/_shared/src/check_marker_runtime.ts` as a byte-grep. It
// answers "is anyone present to be asked", and `/deliver` is FORBIDDEN from
// emitting it (skills/deliver/SKILL.md § Two hard prohibitions) because its
// workers are interactive. So no orchestrator could tell a stage it was driving
// it, and every stage that needed to know had to infer it from prose.
//
// WHY EACH LEG BELOW IS NOT A TAUTOLOGY.
//
//   * AC.1 IS A DIFFERENCE TEST, NOT A PRESENCE TEST. The two bodies compared
//     are byte-identical apart from the literal, asserted by reconstructing one
//     from the other — a leg that merely fed two hand-written strings would
//     pass for a predicate keying on anything else those strings differed in.
//   * AC.2 IS A FOUR-CASE MATRIX. A predicate returning true whenever ANY
//     marker is present passes a one-case test. It fails here, on the
//     headless-only cell.
//   * AC.4 IS SPAN-SCOPED, NEVER FILE-WIDE. Two of the three driving sites
//     share one line, so a file-wide `includes` cannot tell them apart and
//     would pass with two of them empty.
//   * AC.5 ASSERTS SYMMETRY WITH THE SHIPPED READER rather than immunity. Both
//     readers are substring matches; the criterion is that they treat a pasted
//     literal IDENTICALLY, since a driven reader that tried to be cleverer than
//     `checkMarkerRuntime` would be a second, divergent notion of "present".
//   * AC.6 MEASURES THE MUTATION BEFORE SCORING IT. A drop that silently never
//     applied reads as a pass, so each mutation asserts the byte actually left.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { checkMarkerRuntime } from "../adapters/_shared/src/check_marker_runtime";
import {
  DRIVEN_MARKER,
  DRIVEN_TOKEN,
  DRIVING_SITES,
  STANDALONE_TOKEN,
  checkDrivenRuntime,
  drivingSiteSpan,
  drivingSiteSupplies,
  isDrivenRun,
} from "../adapters/_shared/src/driven_run_signal";

const pluginRoot = join(import.meta.dir, "..");
const DELIVER = join(pluginRoot, "skills", "deliver", "SKILL.md");
const deliverBody = () => readFileSync(DELIVER, "utf-8");

/** The shipped headless marker, retyped here on purpose: a shared constant
 *  would let both sides move together and still agree. */
const AUTO_APPROVE_MARKER = "<dpt:auto-approve>v1</dpt:auto-approve>";

/** One realistic invocation body, with no signal of either kind. */
const PLAIN_BODY = [
  "/dev-process-toolkit:spec-write M143",
  "",
  "Write the FRs for the milestone plan on this branch.",
].join("\n");

// ===========================================================================
// AC-STE-549.1 — one readable fact, and no prose inference.
// ===========================================================================

describe("AC-STE-549.1 — driven and standalone differ in exactly one readable fact", () => {
  test("the two bodies are byte-identical apart from the literal", () => {
    const driven = `${DRIVEN_MARKER}\n${PLAIN_BODY}`;
    // Reconstruction, not a second hand-written string: whatever else these
    // bodies differ in, it is nothing, because one is built from the other.
    expect(driven.replace(`${DRIVEN_MARKER}\n`, "")).toBe(PLAIN_BODY);
    expect(isDrivenRun(driven)).toBe(true);
    expect(isDrivenRun(PLAIN_BODY)).toBe(false);
  });

  test("orchestrator-SHAPED prose without the literal is standalone", () => {
    // The whole reason the signal is bytes: a model asked to recognise
    // "looks orchestrated" answers differently on different days.
    for (const prose of [
      "You are a worker spawned by /deliver to run the chain for M143.",
      "This is Phase 2 of an orchestrated delivery run; the next step is /implement.",
      "Driven run. Orchestrator: /deliver. Chain: /implement then /ship-milestone.",
      "dpt:driven",
      "<dpt:driven>v2</dpt:driven>",
      "<dpt:driven>V1</dpt:driven>",
    ]) {
      expect(isDrivenRun(prose), `"${prose}" was read as driven`).toBe(false);
    }
  });

  test("a consumer branches on the predicate, not on the arguments", () => {
    // The predicate takes the invocation body and nothing else — no argv, no
    // env, no classification of what the stage was asked to do.
    expect(isDrivenRun.length).toBe(1);
    expect(checkDrivenRuntime(`x ${DRIVEN_MARKER} y`)).toEqual({ present: true });
  });
});

// ===========================================================================
// AC-STE-549.2 — distinct from the headless marker; four cells, each asserted.
// ===========================================================================

describe("AC-STE-549.2 — the two signals are disjoint", () => {
  test("the literals share no substring and neither contains the other", () => {
    expect(DRIVEN_MARKER).not.toBe(AUTO_APPROVE_MARKER);
    expect(AUTO_APPROVE_MARKER.includes(DRIVEN_MARKER)).toBe(false);
    expect(DRIVEN_MARKER.includes(AUTO_APPROVE_MARKER)).toBe(false);
  });

  test("the four combinations are each expressible and each read correctly", () => {
    const cells: { name: string; body: string; driven: boolean; headless: boolean }[] = [
      { name: "neither", body: PLAIN_BODY, driven: false, headless: false },
      {
        name: "driven only",
        body: `${DRIVEN_MARKER}\n${PLAIN_BODY}`,
        driven: true,
        headless: false,
      },
      {
        name: "headless only",
        body: `${AUTO_APPROVE_MARKER}\n${PLAIN_BODY}`,
        driven: false,
        headless: true,
      },
      {
        name: "both",
        body: `${AUTO_APPROVE_MARKER}\n${DRIVEN_MARKER}\n${PLAIN_BODY}`,
        driven: true,
        headless: true,
      },
    ];
    for (const cell of cells) {
      expect(isDrivenRun(cell.body), `${cell.name}: driven`).toBe(cell.driven);
      expect(
        checkMarkerRuntime(cell.body).present,
        `${cell.name}: headless`,
      ).toBe(cell.headless);
    }
    // The matrix is the assertion: this is the cell a shared-truthiness
    // implementation gets wrong, so it is stated again on its own.
    expect(isDrivenRun(`${AUTO_APPROVE_MARKER}\n${PLAIN_BODY}`)).toBe(false);
    expect(checkMarkerRuntime(`${DRIVEN_MARKER}\n${PLAIN_BODY}`).present).toBe(false);
  });

  test("a driven worker is interactive: the kickoff carries one marker, not both", () => {
    const body = deliverBody();
    expect(body).toContain(DRIVEN_MARKER);
    // The shipped prohibition is unweakened — /deliver still never INJECTS the
    // headless marker; it only names it to forbid it.
    expect(body).toContain("never injects the auto-approve marker");
  });
});

// ===========================================================================
// AC-STE-549.3 — an unsignalled invocation behaves exactly as today.
// ===========================================================================

/**
 * Pre-existing expectation counts in every suite that grades the surface this
 * FR edits, frozen as a literal. Counted as `test(` declarations, measured at
 * 9153402 before any code in this FR landed.
 *
 * `m129-ste-493-gate-class.test.ts` is deliberately NOT in this map: STE-552 of
 * this same milestone is ordered by its own AC.6 and AC.8 to move that file's
 * count and guard pins, so pinning equality here would assert something the
 * milestone's own spec forbids. It is asserted separately below — it may grow,
 * it may never shrink.
 */
const PRE_FR_EXPECTATION_COUNTS: Record<string, number> = {
  "m123-ste-464-deliver-skill.test.ts": 49,
  "m129-ste-492-deliver-fence-producer.test.ts": 37,
  "m129-ste-494-merge-policy-ratchet.test.ts": 89,
  "m129-ste-495-target-repo.test.ts": 67,
  "m129-ste-497-deliver-identity.test.ts": 68,
  "m129-ste-498-resume-classifier.test.ts": 85,
  "m130-ste-502-fr-scope-surfaces.test.ts": 25,
  "m132-ste-510-fence-evidence.test.ts": 75,
  "m133-ste-514-gate-render.test.ts": 101,
  "m133-ste-516-spawn-receipt.test.ts": 99,
  "m134-ste-519-remote-control-field.test.ts": 29,
  "m134-ste-520-worker-naming-both-paths.test.ts": 37,
  "m136-ste-528-firing-caller.test.ts": 61,
};

const EXTENDED_BY_CONTRACT = "m129-ste-493-gate-class.test.ts";
const EXTENDED_BY_CONTRACT_FLOOR = 88;

const declaredTests = (file: string): number =>
  readFileSync(join(pluginRoot, "tests", file), "utf-8")
    .split("\n")
    .filter((line) => /^\s*test\(/.test(line)).length;

describe("AC-STE-549.3 — the existing expectations run unmodified", () => {
  test("every pre-FR suite grading /deliver holds its exact declaration count", () => {
    for (const [file, want] of Object.entries(PRE_FR_EXPECTATION_COUNTS)) {
      expect(declaredTests(file), `${file} changed its expectation count`).toBe(want);
    }
  });

  test("the one suite this milestone extends by contract never SHRINKS", () => {
    expect(declaredTests(EXTENDED_BY_CONTRACT)).toBeGreaterThanOrEqual(
      EXTENDED_BY_CONTRACT_FLOOR,
    );
  });

  test("an unsignalled body is read as standalone whatever else it carries", () => {
    for (const body of [
      "",
      PLAIN_BODY,
      deliverBody().replaceAll(DRIVEN_MARKER, ""),
      `${AUTO_APPROVE_MARKER}\n${PLAIN_BODY}`,
    ]) {
      expect(isDrivenRun(body)).toBe(false);
    }
  });
});

// ===========================================================================
// AC-STE-549.4 — /deliver supplies it at every surface it drives.
// ===========================================================================

describe("AC-STE-549.4 — all three driving sites supply the signal", () => {
  test("the three sites are distinct and each anchor occurs exactly once", () => {
    const body = deliverBody();
    expect(DRIVING_SITES.length).toBe(3);
    expect(new Set(DRIVING_SITES.map((s) => s.id)).size).toBe(3);
    for (const site of DRIVING_SITES) {
      expect(body.split(site.anchor).length - 1, `${site.id} anchor`).toBe(1);
    }
  });

  test("each site's own SPAN carries the literal", () => {
    const body = deliverBody();
    for (const site of DRIVING_SITES) {
      const span = drivingSiteSpan(body, site.id);
      expect(span, `${site.id} anchor missing`).not.toBeNull();
      expect(span!.includes(DRIVEN_MARKER), `${site.id} withholds the signal`).toBe(
        true,
      );
      expect(drivingSiteSupplies(body, site.id)).toBe(true);
    }
  });

  test("the spans do not overlap — the two inline sites are told apart", () => {
    const body = deliverBody();
    const p1 = drivingSiteSpan(body, "phase1_brainstorm_inline")!;
    const p2 = drivingSiteSpan(body, "phase2_spec_write_inline")!;
    expect(p1.includes(p2)).toBe(false);
    expect(p2.includes(p1)).toBe(false);
    // Both live on the same line: a line-scoped read would score them as one.
    const line = body.split("\n").find((l) => l.includes(p1))!;
    expect(line.includes(p2)).toBe(true);
  });

  test("the deterministic read is ordered, not left to judgement", () => {
    const body = deliverBody();
    expect(body).toContain("adapters/_shared/src/driven_run_signal.ts");
    expect(body).toContain("isDrivenRun");
  });
});

// ===========================================================================
// AC-STE-549.5 — forgery is treated exactly as the shipped marker treats it.
// ===========================================================================

describe("AC-STE-549.5 — the two readers treat a pasted literal identically", () => {
  test("quoted user prose carrying the literal reads the same on both sides", () => {
    const quoted = (marker: string) =>
      [
        "/dev-process-toolkit:implement STE-549",
        "",
        `The operator asked: why does "${marker}" appear in the kickoff text?`,
      ].join("\n");
    // Same position, same quoting, same answer — symmetry is the criterion.
    expect(isDrivenRun(quoted(DRIVEN_MARKER))).toBe(true);
    expect(checkMarkerRuntime(quoted(AUTO_APPROVE_MARKER)).present).toBe(true);
    // And the cross pairs stay false, so this is symmetry and not blindness.
    expect(isDrivenRun(quoted(AUTO_APPROVE_MARKER))).toBe(false);
    expect(checkMarkerRuntime(quoted(DRIVEN_MARKER)).present).toBe(false);
  });

  test("byte-altered variants are rejected by both readers alike", () => {
    for (const [driven, headless] of [
      ["<dpt:driven>v2</dpt:driven>", "<dpt:auto-approve>v2</dpt:auto-approve>"],
      ["<dpt:DRIVEN>v1</dpt:DRIVEN>", "<dpt:AUTO-APPROVE>v1</dpt:AUTO-APPROVE>"],
      ["<dpt:driven>v1", "<dpt:auto-approve>v1"],
    ]) {
      expect(isDrivenRun(driven!)).toBe(false);
      expect(checkMarkerRuntime(headless!).present).toBe(false);
    }
  });

  test("the signal authorizes nothing — it is not a gate answer", () => {
    // Stated as an assertion because it is the reason the substring match is
    // safe: nothing in this module decides an approval.
    const src = readFileSync(
      join(pluginRoot, "adapters", "_shared", "src", "driven_run_signal.ts"),
      "utf-8",
    );
    expect(src).not.toContain("relayRequired");
    expect(src).not.toContain("delegationCovers");
    expect(src).not.toContain("classifyGate");
  });
});

// ===========================================================================
// AC-STE-549.6 — falsifiability: drop the signal at one site only.
// ===========================================================================

describe("AC-STE-549.6 — MUTATION: removing one site's signal is visible there alone", () => {
  test("each driving site is load-bearing on its own", () => {
    const body = deliverBody();
    for (const site of DRIVING_SITES) {
      const span = drivingSiteSpan(body, site.id)!;
      const stripped = span.replaceAll(DRIVEN_MARKER, "");
      // MUTATION APPLIED? Measured before it is scored.
      expect(stripped.length, `${site.id}: mutation did not apply`).toBeLessThan(
        span.length,
      );
      const mutated = body.replace(span, stripped);
      expect(
        drivingSiteSupplies(mutated, site.id),
        `${site.id} is not load-bearing`,
      ).toBe(false);
      for (const other of DRIVING_SITES) {
        if (other.id === site.id) continue;
        expect(
          drivingSiteSupplies(mutated, other.id),
          `${site.id}'s mutation leaked into ${other.id}`,
        ).toBe(true);
      }
    }
  });

  test("a stage invoked at a mutated site reads STANDALONE", () => {
    const body = deliverBody();
    const site = DRIVING_SITES[0]!;
    const span = drivingSiteSpan(body, site.id)!;
    const mutated = body.replace(span, span.replaceAll(DRIVEN_MARKER, ""));
    const verdict = (b: string) =>
      drivingSiteSupplies(b, site.id) ? DRIVEN_TOKEN : STANDALONE_TOKEN;
    expect(verdict(body)).toBe(DRIVEN_TOKEN);
    expect(verdict(mutated)).toBe(STANDALONE_TOKEN);
  });
});

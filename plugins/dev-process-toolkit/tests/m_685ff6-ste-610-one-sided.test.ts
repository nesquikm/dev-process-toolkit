// STE-610 (M_685ff6) — AC-STE-610.5: a one-sided span is held before release.
//
// Refusal #4 adds a tenth sibling state, `one-sided`: a located sibling whose
// plan for the milestone, read through STE-609's git-state reader, resolves no
// entry to this repository (by `sameRepository`) — including a sibling plan
// with no `spans_repos:` at all. Refusal #4 refuses on it without `--partial`,
// probe #75 renders `awaiting-sibling milestones: <token> (<sibling>: one-sided)`,
// the close-offer CLI holds it, and both resume scopes treat it as awaiting.
// On HEAD such a sibling reads `idle`, so the release ships with exit 0 and the
// mismatch surfaces only after it, in probe #63.
//
// Trees are the STE-609 `idle` tree with one fact changed: B's plan — committed,
// so every git source agrees — stops naming A back. Torn down in a `finally`.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { relative } from "node:path";

import {
  runActivePlanShipReadyProbe,
  spanningSiblingState,
} from "../adapters/_shared/src/active_plan_ship_ready";
import { classifyResume, resumeChain } from "../adapters/_shared/src/resume_classifier";
import { siblingShipGate } from "../adapters/_shared/src/sibling_release";
import { commitAll, makeSpanFixture } from "./_span_fixture";
import {
  A_FR,
  B_NAME,
  MILESTONE,
  type StateTree,
  buildState,
  closeOfferDoor,
  describeRun,
  lines,
  shipGateDoor,
  writePlan,
} from "./_sibling_state_fixture";

type Variant = "undeclared" | "names-another";

/**
 * The STE-609 `idle` tree, with B's plan rewritten so it does not name A back:
 * `undeclared` drops `spans_repos:` entirely; `names-another` declares B itself
 * and a THIRD repository C — a valid declaration from B's root that resolves
 * no entry to A.
 */
async function withOneSided<T>(
  variant: Variant,
  body: (t: StateTree) => Promise<T> | T,
  opts: { local?: "archived" | "active" } = {},
): Promise<T> {
  const t = buildState("idle", opts);
  const third = variant === "names-another" ? makeSpanFixture(MILESTONE) : null;
  try {
    if (variant === "undeclared") {
      writePlan(t.fx.b, "live", MILESTONE, {});
    } else {
      writePlan(t.fx.b, "live", MILESTONE, { [B_NAME]: ".", "glacy-app-ops": relative(t.fx.b, third!.a) });
    }
    commitAll(t.fx.b, `fixture: B's plan is one-sided (${variant})`);
    return await body(t);
  } finally {
    try {
      t.cleanup();
    } finally {
      third?.cleanup();
    }
  }
}

const VARIANTS: readonly Variant[] = ["undeclared", "names-another"];
const read = (p: string): string => readFileSync(p, "utf-8");
const skills = (chain: readonly { skill: string }[]): string[] => chain.map((s) => s.skill);

describe("AC-STE-610.5 — the one classification names the state one-sided", () => {
  for (const variant of VARIANTS) {
    test(`a sibling whose plan does not name this repository back (${variant}) is one-sided (red on HEAD: idle)`, async () => {
      await withOneSided(variant, async (t) => {
        const { siblings } = await spanningSiblingState(t.a, read(t.planFile), MILESTONE);
        expect(siblings.map((s) => [s.name, s.state])).toEqual([[B_NAME, "one-sided"]]);
      });
    }, 30_000);
  }

  test("(control) a sibling that names this repository back and is otherwise idle stays idle", async () => {
    const t = buildState("idle");
    try {
      const { siblings } = await spanningSiblingState(t.a, read(t.planFile), MILESTONE);
      expect(siblings.map((s) => [s.name, s.state])).toEqual([[B_NAME, "idle"]]);
    } finally {
      t.cleanup();
    }
  }, 30_000);
});

describe("AC-STE-610.5 — refusal #4 holds a one-sided span before release", () => {
  for (const variant of VARIANTS) {
    test(`in process: refuses without --partial, naming the sibling and one-sided (${variant}) (red on HEAD)`, async () => {
      await withOneSided(variant, async (t) => {
        const result = await siblingShipGate({
          projectRoot: t.a,
          planBody: read(t.planFile),
          milestone: MILESTONE,
          partial: false,
        });
        expect(result.refusal, "the gate passed a one-sided span").not.toBeNull();
        expect(result.refusal!).toContain(B_NAME);
        expect(result.refusal!).toContain("one-sided");
        expect(result.refusal!).toContain("--partial");
        expect(result.footer).toEqual([]);
      });
    }, 30_000);

    test(`front door: exit 1, empty stdout, the refusal names one-sided (${variant}) (red on HEAD: exit 0)`, async () => {
      await withOneSided(variant, (t) => {
        const r = shipGateDoor(t.a, t.planFile, MILESTONE);
        expect(r.status, describeRun(r)).toBe(1);
        expect(r.stdout, describeRun(r)).toBe("");
        expect(r.stderr, describeRun(r)).toMatch(/^\/ship-milestone: /);
        expect(r.stderr).toContain(B_NAME);
        expect(r.stderr).toContain("one-sided");
      });
    }, 30_000);
  }

  test("(control) front door: --partial ships this half of a one-sided span", async () => {
    await withOneSided("undeclared", (t) => {
      const r = shipGateDoor(t.a, t.planFile, MILESTONE, true);
      expect(r.status, describeRun(r)).toBe(0);
      expect(r.stdout).toBe(`Spans: ${B_NAME}@pending\n`);
    });
  }, 30_000);

  test("(control) front door: a sibling that names this repository back and is otherwise idle passes", async () => {
    const t = buildState("idle");
    try {
      const r = shipGateDoor(t.a, t.planFile, MILESTONE);
      expect(r.status, describeRun(r)).toBe(0);
      expect(r.stdout).toBe(`Spans: ${B_NAME}@pending\n`);
    } finally {
      t.cleanup();
    }
  }, 30_000);
});

describe("AC-STE-610.5 — every surface holds a one-sided span", () => {
  test("probe #75 renders `awaiting-sibling milestones: <token> (<sibling>: one-sided)` and not ship-ready (red on HEAD)", async () => {
    await withOneSided("undeclared", async (t) => {
      const report = await runActivePlanShipReadyProbe(t.a);
      expect(report.notes.some((n) => n.startsWith("ship-ready milestones:")), report.notes.join("\n")).toBe(false);
      expect(report.notes).toContain(`awaiting-sibling milestones: ${MILESTONE} (${B_NAME}: one-sided)`);
    });
  }, 30_000);

  test("close-offer CLI: `held: <token> (<sibling>: one-sided)` on stderr, empty stdout, exit 0 (red on HEAD)", async () => {
    await withOneSided("undeclared", (t) => {
      const r = closeOfferDoor(t.a);
      expect(r.status, describeRun(r)).toBe(0);
      expect(r.stdout, describeRun(r)).toBe("");
      expect(lines(r.stderr), describeRun(r)).toEqual([`held: ${MILESTONE} (${B_NAME}: one-sided)`]);
    });
  }, 30_000);

  test("milestone-scope resume: awaiting, the chain orders nothing (red on HEAD)", async () => {
    await withOneSided("undeclared", async (t) => {
      const c = await classifyResume(t.a, { scope: "milestone", milestone: MILESTONE });
      expect({ awaiting: (c.awaitingSiblings ?? []).length > 0, chain: skills(resumeChain(c)) }).toEqual({
        awaiting: true,
        chain: [],
      });
    });
  }, 30_000);

  test("FR-scope resume: the last local FR stops at /pr (red on HEAD)", async () => {
    await withOneSided(
      "undeclared",
      async (t) => {
        const c = await classifyResume(t.a, { scope: "fr", fr: A_FR, milestone: MILESTONE });
        expect({
          last: c.lastActiveFr,
          awaiting: (c.awaitingSiblings ?? []).length > 0,
          chain: skills(resumeChain(c)),
        }).toEqual({ last: true, awaiting: true, chain: ["/implement", "/pr"] });
      },
      { local: "active" },
    );
  }, 30_000);
});


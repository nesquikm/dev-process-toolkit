// STE-609 (M_685ff6) — AC-STE-609.7: `/deliver` names the cause.
//
// A milestone-scope resume whose spanning sibling is held used to refuse with
// "the delivery decision record carries no `chain` field" — the empty chain of
// a waiting milestone reached the record renderer, which named the wrong
// cause. The front door now says the sibling and its state, with a remedy
// naming `--partial`. The FR-scope record whose chain stops at `/pr` keeps its
// eight labelled fields and gains one advisory line naming the sibling and
// state. And `dispatchResume`, handed an empty chain, claims nothing and
// spawns nothing.
//
// Front doors are spawned as subprocesses by path from the plugin root, one at
// a time, under GIT_ENV.

import { describe, expect, test } from "bun:test";

import { DECISION_FIELDS } from "../adapters/_shared/src/deliver_decision";
import {
  type ResumeChainStep,
  type ResumeSpawn,
  runResume,
} from "../adapters/_shared/src/resume_classifier";
import {
  A_FR,
  B_NAME,
  DELIVER_DOOR,
  MILESTONE,
  type SiblingStateName,
  describeRun,
  lines,
  runModule,
  withState,
} from "./_sibling_state_fixture";

const CHAIN_FIELD_TEXT = "carries no `chain` field";

/** A word-bounded match for a state name (hyphens included). */
const stateWord = (state: string): RegExp =>
  new RegExp(`(^|[^a-z-])${state.replace(/-/g, "\\-")}([^a-z-]|$)`);

const deliverDoor = (argument: string, projectRoot: string) =>
  runModule(DELIVER_DOOR, [argument, projectRoot]);

/** Counting sinks for a resume run; the gate confirms, or edits to `edit`. */
function sinks(edit?: readonly ResumeChainStep[]) {
  const calls = { present: 0, claim: 0, claimFr: 0, spawn: 0, inline: 0 };
  const spawned: ResumeSpawn[] = [];
  return {
    calls,
    spawned,
    gate: {
      present() {
        calls.present++;
        return edit === undefined
          ? { decision: "confirm" as const }
          : { decision: "edit" as const, chain: edit };
      },
    },
    spawn: {
      spawnWorker(s: ResumeSpawn) {
        calls.spawn++;
        spawned.push(s);
      },
    },
    inline: {
      runInline() {
        calls.inline++;
      },
    },
    tracker: {
      claimMilestone() {
        calls.claim++;
      },
      claimFr() {
        calls.claimFr++;
      },
    },
  };
}

/** A run's outcome as text: the rejection message, or the resolved outcome. */
async function outcomeText(run: () => Promise<unknown>): Promise<string> {
  try {
    return JSON.stringify(await run());
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

describe("AC-STE-609.7 — the /deliver front door names a held sibling as the cause", () => {
  const held: SiblingStateName[] = ["busy", "unlocatable", "not-started"];
  for (const state of held) {
    test(`milestone scope, sibling ${state}: exit 1, an NFR-10 verdict naming ${B_NAME} and ${state}, a remedy naming --partial, and never the chain-field text (red on HEAD)`, async () => {
      await withState(state, (t) => {
        const run = deliverDoor(MILESTONE, t.a);
        expect(run.status, describeRun(run)).toBe(1);
        expect(run.stdout, describeRun(run)).toBe("");
        expect(run.stderr, describeRun(run)).not.toContain(CHAIN_FIELD_TEXT);
        const err = lines(run.stderr);
        const refusing = err.find((l) => l.startsWith("Refusing: "));
        const remedy = err.find((l) => l.startsWith("Remedy: "));
        expect(refusing, describeRun(run)).toBeDefined();
        expect(remedy, describeRun(run)).toBeDefined();
        expect(err.some((l) => l.startsWith("Context: ")), describeRun(run)).toBe(true);
        expect(refusing!).toContain(B_NAME);
        expect(refusing!).toMatch(stateWord(state));
        expect(remedy!).toContain("--partial");
      });
    }, 30_000);
  }

  test("FR scope, chain stopped at /pr by a held sibling: the eight labelled fields unchanged, then one advisory line naming the sibling and state (red on HEAD)", async () => {
    await withState(
      "busy",
      (t) => {
        const run = deliverDoor(A_FR, t.a);
        expect(run.status, describeRun(run)).toBe(0);
        const out = lines(run.stdout);
        // The eight labelled fields, in their fixed order, as the record prints them.
        const labelled = out.filter((l) => /^[a-z_]+:( |$)/.test(l));
        expect(labelled.map((l) => l.split(":", 1)[0])).toEqual([...DECISION_FIELDS]);
        expect(out).toContain("resume_state: ready_to_implement");
        expect(out).toContain(`  1. /implement ${A_FR} (worker)`);
        expect(out).toContain(`  2. /pr ${MILESTONE} (worker)`);
        expect(out.some((l) => l.includes("/ship-milestone"))).toBe(false);
        // …followed by exactly one advisory line, after the record, that is not a label.
        const last = out.findIndex((l) => l.startsWith("remote_control: "));
        const after = out.slice(last + 1);
        const advisories = after.filter((l) => l.includes(B_NAME));
        expect(advisories, describeRun(run)).toHaveLength(1);
        expect(advisories[0]!).not.toMatch(/^[a-z_]+: /);
        expect(advisories[0]!).toMatch(stateWord("busy"));
      },
      { local: "active" },
    );
  }, 30_000);

  test("(control) an idle sibling's milestone-scope record still prints, its chain carrying /ship-milestone", async () => {
    await withState("idle", (t) => {
      const run = deliverDoor(MILESTONE, t.a);
      expect(run.status, describeRun(run)).toBe(0);
      expect(run.stdout).toContain(`/ship-milestone ${MILESTONE} (worker)`);
      expect(run.stderr, describeRun(run)).toBe("");
    });
  }, 30_000);
});

describe("AC-STE-609.7 — dispatchResume given an empty chain claims nothing and spawns nothing", () => {
  test("a held milestone-scope resume, confirmed: zero claims, zero spawns, and a refusal naming the held sibling (red on HEAD)", async () => {
    await withState("busy", async (t) => {
      const s = sinks();
      const text = await outcomeText(() =>
        runResume({
          projectRoot: t.a,
          milestone: MILESTONE,
          gate: s.gate,
          spawn: s.spawn,
          inline: s.inline,
          tracker: s.tracker,
        }),
      );
      expect(s.calls.claim + s.calls.claimFr, `claims: ${JSON.stringify(s.calls)}`).toBe(0);
      expect(s.calls.spawn, `spawned: ${JSON.stringify(s.spawned)}`).toBe(0);
      expect(text).toContain(B_NAME);
      expect(text).toMatch(stateWord("busy"));
    });
  });

  test("an operator edit to an empty chain on an idle milestone: zero claims, zero spawns (red on HEAD)", async () => {
    await withState("idle", async (t) => {
      const s = sinks([]);
      await outcomeText(() =>
        runResume({
          projectRoot: t.a,
          milestone: MILESTONE,
          gate: s.gate,
          spawn: s.spawn,
          inline: s.inline,
          tracker: s.tracker,
        }),
      );
      expect(s.calls.claim + s.calls.claimFr, `claims: ${JSON.stringify(s.calls)}`).toBe(0);
      expect(s.calls.spawn, `spawned: ${JSON.stringify(s.spawned)}`).toBe(0);
    });
  });

  test("(control) an idle milestone-scope resume, confirmed, claims once and spawns one worker", async () => {
    await withState("idle", async (t) => {
      const s = sinks();
      await runResume({
        projectRoot: t.a,
        milestone: MILESTONE,
        gate: s.gate,
        spawn: s.spawn,
        inline: s.inline,
        tracker: s.tracker,
      });
      expect(s.calls.claim).toBe(1);
      expect(s.calls.spawn).toBe(1);
      expect(s.spawned[0]!.chain.map((c) => c.skill)).toContain("/ship-milestone");
    });
  });
});

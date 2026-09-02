// M138 STE-537 — `/setup` step 8's mode-conditional scaffold plan identity.
//
// THE DEFECT (measured, v2.75.0). Step 8 writes the bootstrap plan at
// `specs/plan/M1.md` under EVERY mode, including `mode: none` — the one mode
// whose milestone ids are minted (`M_<6-char Crockford tail>`), never
// sequential. Nothing reds on it: probe #73 exempts `kind: scaffolding` from
// the provenance arm, so the mis-named plan simply waits for the author's
// first `/spec-write`.
//
// THE UNIT UNDER TEST HERE: the pure naming decision, extracted so the
// filename choice is a function of the mode and nothing else.
//
//   scaffoldPlanIdentity(specsDir, mode) → { fileName, id? }
//     - "none"             ⇒ { fileName: `${milestoneIdFromUlid(id)}.md`, id }
//                            with `id` the FULL 29-char minted value verbatim.
//     - "linear" / "jira"  ⇒ { fileName: "M1.md" } and the `id` key
//                            STRUCTURALLY ABSENT — not present-and-undefined.
//                            A present key serialises into frontmatter and
//                            probe #73's tracker arm fails ANY `id:` line.
//
// DELIBERATELY NOT `resolveMilestoneIdentity`: its linear branch runs the
// five-way availability scan rather than the literal `M1` step 8 has always
// written, and its jira branch throws on the absent bootstrap Epic key. This
// helper answers "what does /setup call the bootstrap plan", which is a
// different question from "what is the next milestone".
//
// LAZY MODULE LOAD, as in `tests/m126-ste-481-single-active-plan.test.ts`: a
// top-level `import` of a file that does not exist yet collapses every leg
// below into one undifferentiated module-load error, and the RED then reads
// as a stack trace rather than as an AC map.

import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { milestoneIdFromUlid, PLAN_FILENAME_RE } from "./milestone_token";
import type { MilestoneIdentityMode } from "./resolve_milestone_identity";
import { ULID_REGEX } from "./ulid";

const MODULE_PATH = join(import.meta.dir, "setup_scaffold_plan_identity.ts");

/** The `M_<6-char Crockford tail>` shape `milestoneIdFromUlid` derives. */
const MINTED_PLAN_FILE_RE = /^M_[0-9A-HJKMNP-TV-Z]{6}\.md$/;

interface ScaffoldPlanIdentity {
  fileName: string;
  id?: string;
}

interface ScaffoldPlanIdentityModule {
  scaffoldPlanIdentity(
    specsDir: string,
    mode: MilestoneIdentityMode,
    epicKey?: string,
  ): ScaffoldPlanIdentity;
}

async function loadHelper(): Promise<ScaffoldPlanIdentityModule> {
  if (!existsSync(MODULE_PATH)) {
    throw new Error(
      `adapters/_shared/src/setup_scaffold_plan_identity.ts does not exist — /setup step 8 has ` +
        `nothing to ask for the bootstrap plan's name, so it keeps writing specs/plan/M1.md ` +
        `under mode: none.`,
    );
  }
  const mod = (await import(MODULE_PATH)) as Partial<ScaffoldPlanIdentityModule>;
  if (typeof mod.scaffoldPlanIdentity !== "function") {
    throw new Error(
      `adapters/_shared/src/setup_scaffold_plan_identity.ts does not export scaffoldPlanIdentity()`,
    );
  }
  return mod as ScaffoldPlanIdentityModule;
}

interface Fixture {
  specsDir: string;
  cleanup: () => void;
}

/** A bare `specs/plan/{,archive/}` tree — the minter probes both directories. */
function makeSpecsDir(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "ste537-scaffold-identity-"));
  const specsDir = join(root, "specs");
  mkdirSync(join(specsDir, "plan", "archive"), { recursive: true });
  return { specsDir, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

/**
 * THE MATCHER AC.1's absence claim is measured with. `never M1.md` is an
 * ABSENCE, and a bare `not.toBe("M1.md")` proves nothing about a comparison
 * that might be incapable of matching `M1.md` on any input at all. Every leg
 * that asserts this returns false also has a sibling proving it returns true.
 */
const namesTheSequentialBootstrapPlan = (fileName: string): boolean => fileName === "M1.md";

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-537.1 — mode: none names `M_<tail>.md`, never `M1.md`
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-STE-537.1 — the tracker-less branch names a MINTED plan file", () => {
  test("50 consecutive mints all derive their own filename from their own id", async () => {
    const helper = await loadHelper();
    const f = makeSpecsDir();
    try {
      const ids = new Set<string>();
      for (let i = 0; i < 50; i++) {
        const result = helper.scaffoldPlanIdentity(f.specsDir, "none");

        expect(result.fileName).toMatch(MINTED_PLAN_FILE_RE);
        // The SHARED grammar, not a private lookalike: every `specs/plan/**`
        // walker gates on this one constant, so a name it rejects is a plan
        // file no probe would even see.
        expect(PLAN_FILENAME_RE.test(result.fileName)).toBe(true);

        expect(result.id).toBeDefined();
        expect(result.id!).toMatch(ULID_REGEX);
        // DERIVATION, not shape. A shape-only assertion passes on any
        // well-formed 6-char tail, including one unrelated to the recorded id
        // — which is exactly the state probe #73 fails as
        // "an id: the filename derives from".
        expect(result.fileName).toBe(`${milestoneIdFromUlid(result.id!)}.md`);

        ids.add(result.id!);
      }
      expect(ids.size).toBe(50);
    } finally {
      f.cleanup();
    }
  });

  test("POSITIVE CONTROL — the same matcher DOES match on the linear branch", async () => {
    const helper = await loadHelper();
    const f = makeSpecsDir();
    try {
      const tracker = helper.scaffoldPlanIdentity(f.specsDir, "linear");
      const minted = helper.scaffoldPlanIdentity(f.specsDir, "none");

      // Without this leg, `false` below could mean "the comparison can never
      // be true", which would be a vacuous absence claim.
      expect(namesTheSequentialBootstrapPlan(tracker.fileName)).toBe(true);
      expect(namesTheSequentialBootstrapPlan(minted.fileName)).toBe(false);
    } finally {
      f.cleanup();
    }
  });

  test("CONTROL — an M1.md already on disk does not make the minter return it", async () => {
    const helper = await loadHelper();
    const f = makeSpecsDir();
    try {
      // Proves the answer is a MINT, not "whichever bootstrap name is free":
      // an allocator that reused a taken sequential name, or avoided one, would
      // both be wrong here for the same reason — the name is never sequential.
      writeFileSync(
        join(f.specsDir, "plan", "M1.md"),
        "---\nmilestone: M1\nstatus: active\narchived_at: null\n---\n\n# M1\n",
      );

      const result = helper.scaffoldPlanIdentity(f.specsDir, "none");
      expect(namesTheSequentialBootstrapPlan(result.fileName)).toBe(false);
      expect(result.fileName).toMatch(MINTED_PLAN_FILE_RE);
      expect(result.fileName).toBe(`${milestoneIdFromUlid(result.id!)}.md`);
    } finally {
      f.cleanup();
    }
  });

  test("naming is PURE — the helper never creates the plan file it names", async () => {
    const helper = await loadHelper();
    const f = makeSpecsDir();
    try {
      const result = helper.scaffoldPlanIdentity(f.specsDir, "none");
      // Minting names a plan file; step 8 writes it. A helper that created the
      // file would double-write the moment step 8 wrote its own body.
      expect(existsSync(join(f.specsDir, "plan", result.fileName))).toBe(false);
    } finally {
      f.cleanup();
    }
  });

  test("the minted name does not collide with a plan already claiming that tail", async () => {
    const helper = await loadHelper();
    const f = makeSpecsDir();
    try {
      const first = helper.scaffoldPlanIdentity(f.specsDir, "none");
      writeFileSync(join(f.specsDir, "plan", first.fileName), "---\nmilestone: x\n---\n");

      const second = helper.scaffoldPlanIdentity(f.specsDir, "none");
      expect(second.fileName).not.toBe(first.fileName);
    } finally {
      f.cleanup();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-STE-537.3 — linear and jira are byte-identical to today
// ═══════════════════════════════════════════════════════════════════════════

describe("AC-STE-537.3 — tracker modes keep `M1.md` and carry NO `id` key", () => {
  // KEY SET, not `id === undefined`. A present-but-undefined key still
  // serialises into frontmatter, and probe #73's tracker arm fails ANY `id:`
  // line — so the assertion has to be about the key's existence, not its value.
  const keysOf = (result: ScaffoldPlanIdentity): string[] => Object.keys(result).sort();

  test("linear returns exactly `{ fileName }`", async () => {
    const helper = await loadHelper();
    const f = makeSpecsDir();
    try {
      const result = helper.scaffoldPlanIdentity(f.specsDir, "linear");
      expect(keysOf(result)).toEqual(["fileName"]);
      expect(result.fileName).toBe("M1.md");
      expect("id" in result).toBe(false);
    } finally {
      f.cleanup();
    }
  });

  test("jira returns exactly `{ fileName }` — with AND without an Epic key", async () => {
    const helper = await loadHelper();
    const f = makeSpecsDir();
    try {
      const bare = helper.scaffoldPlanIdentity(f.specsDir, "jira");
      const keyed = helper.scaffoldPlanIdentity(f.specsDir, "jira", "PROJ-500");

      // The bootstrap plan is written BEFORE any Epic exists, so an Epic key
      // must not change the answer — and its absence must not throw the way
      // `resolveMilestoneIdentity`'s jira branch does.
      expect(keysOf(bare)).toEqual(["fileName"]);
      expect(keysOf(keyed)).toEqual(["fileName"]);
      expect(bare.fileName).toBe("M1.md");
      expect(keyed.fileName).toBe("M1.md");
    } finally {
      f.cleanup();
    }
  });

  test("POSITIVE CONTROL — the same key listing finds `id` on the none branch", async () => {
    const helper = await loadHelper();
    const f = makeSpecsDir();
    try {
      // Without this, `["fileName"]` above could be reporting on an expression
      // structurally unable to see a second key.
      expect(keysOf(helper.scaffoldPlanIdentity(f.specsDir, "none"))).toEqual(["fileName", "id"]);
    } finally {
      f.cleanup();
    }
  });

  test("a tracker-mode call never touches the plan tree", async () => {
    const helper = await loadHelper();
    const f = makeSpecsDir();
    try {
      helper.scaffoldPlanIdentity(f.specsDir, "linear");
      helper.scaffoldPlanIdentity(f.specsDir, "jira", "PROJ-500");
      expect(existsSync(join(f.specsDir, "plan", "M1.md"))).toBe(false);
    } finally {
      f.cleanup();
    }
  });
});

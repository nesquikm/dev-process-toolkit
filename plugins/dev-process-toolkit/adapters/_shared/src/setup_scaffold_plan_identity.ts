// setup_scaffold_plan_identity — STE-537 AC-STE-537.1/.3: what `/setup` step 8
// calls the bootstrap plan it scaffolds.
//
// THE DEFECT this closes (measured, v2.75.0). Step 8 wrote
// `specs/plan/M1.md` under EVERY mode. Under `mode: none` the milestone
// grammar is MINTED (`M_<6-char Crockford tail>`, derived from an `fr_`-prefixed
// ULID recorded verbatim as `id:`), so the sequential name is the one shape
// that mode never produces — and nothing reds on it, because probe #73 exempts
// `kind: scaffolding` from the provenance arm. The mismatch simply waits for
// the author's first `/spec-write`.
//
// DELIBERATELY NOT `resolveMilestoneIdentity`. That dispatcher answers "what is
// the NEXT milestone", and every one of its tracker branches answers it in a
// way the bootstrap cannot use. Its `linear` branch MINTS — since STE-541 it
// creates a project milestone in the tracker and derives the identity from the
// identifier that comes back, so asking it for the bootstrap name would create
// a real milestone for a plan `/setup` names `M1` by convention; before that it
// ran the five-way availability scan, which likewise never yielded the literal
// `M1` step 8 has always written. Its `jira` branch throws on the absent
// bootstrap Epic key — the bootstrap plan is written before any Epic exists. This helper answers the narrower question "what does
// /setup call the bootstrap plan", so it shares only the `none` branch's
// delegate (`mintMilestoneId`) and hard-codes the sequential bootstrap name for
// the tracker modes.
//
// The `id` key is STRUCTURALLY ABSENT on the tracker branches, not
// present-and-undefined: step 8 serialises the returned identity into plan
// frontmatter, and probe #73's tracker arm fails ANY `id:` line.
//
// Naming is PURE — it names a plan file, it never creates one. Step 8 writes
// the body.
//
// Synchronous: the only delegate (`mintMilestoneId`) is synchronous, and the
// tracker branches are literals.

import { resolve } from "node:path";
import { mintMilestoneId } from "./mint_milestone_id";
import type { MilestoneIdentityMode } from "./resolve_milestone_identity";

/** The filename step 8 has always written under a tracker mode. */
export const SEQUENTIAL_SCAFFOLD_PLAN_FILE = "M1.md";

/** What step 8 needs in order to write the bootstrap plan. */
export interface ScaffoldPlanIdentity {
  /** Plan filename, relative to `<specsDir>/plan/`: `M1.md` or `M_<tail>.md`. */
  fileName: string;
  /**
   * The full 29-char `fr_`-prefixed minted id, written verbatim as the plan's
   * `id:` line. Present on the `none` branch ONLY — the key is absent, not
   * undefined, on the tracker branches.
   */
  id?: string;
}

/**
 * Decide the bootstrap plan's name for `/setup` step 8.
 *
 * - `none` → a freshly minted identity: `fileName` derives from `id` via
 *   `milestoneIdFromUlid`, so the written frontmatter satisfies probe #73's
 *   "an id: the filename derives from" row.
 * - `linear` / `jira` → `{ fileName: "M1.md" }`, byte-identical to the
 *   pre-STE-537 behavior. `epicKey` is accepted for call-site symmetry with
 *   `resolveMilestoneIdentity` and deliberately ignored: the bootstrap plan
 *   predates any Epic, so its presence or absence must not change the answer
 *   (and must not throw).
 */
export function scaffoldPlanIdentity(
  specsDir: string,
  mode: MilestoneIdentityMode,
  _epicKey?: string,
): ScaffoldPlanIdentity {
  if (mode === "none") {
    const minted = mintMilestoneId(specsDir);
    return { fileName: `${minted.milestoneId}.md`, id: minted.id };
  }
  return { fileName: SEQUENTIAL_SCAFFOLD_PLAN_FILE };
}

// ---------------------------------------------------------------------------
// Command-line entry point
// ---------------------------------------------------------------------------
//
// WHY IT EXISTS. `/setup` step 8 ORDERS this module by name
// (`skills/setup/SKILL.md`), and an order addressed to a reader has to be
// runnable BY that reader — a module named in shipped prose with no front door
// is precisely the unreachable-order class /gate-check probe #81 exists to
// catch. This door hands back the two values step 8 needs before it can write
// the bootstrap plan: the filename, and — on the `none` branch alone — the
// minted `id:` to record in that plan's frontmatter.
//
//   bun run adapters/_shared/src/setup_scaffold_plan_identity.ts specs none
//   fileName=M_7ZQ4KD.md
//   id=fr_01K4Q8V2N3PXR7ZQ4KD5MBWTGE
//   plan=specs/plan/M_7ZQ4KD.md
//
// The mode is TAKEN, never guessed: it is read off `## Task Tracking` by the
// caller, and a door that inferred one could name a plan for a mode the project
// is not in. An unknown mode refuses here — naming all three valid modes —
// rather than falling through to the sequential literal, which is the same
// posture `resolveMilestoneIdentity` takes on an unknown mode.
//
// Naming stays PURE at this door too: nothing is created, exactly as in the
// exported function. `import.meta.main` is false on import, so the module stays
// side-effect-free for step 8 and for every test that imports it.
if (import.meta.main) {
  const specsDir = resolve(process.argv[2] ?? "specs");
  const mode = process.argv[3];

  if (mode !== "linear" && mode !== "jira" && mode !== "none") {
    console.error(
      [
        `Refusing: to name a bootstrap plan for the mode ${mode === undefined ? "<missing>" : `\`${mode}\``} — valid modes are \`linear\`, \`jira\`, \`none\`.`,
        "Remedy: bun run adapters/_shared/src/setup_scaffold_plan_identity.ts <specsDir> <linear|jira|none>",
        "Context: phase=setup-step-8, surface=scaffold-plan-identity",
      ].join("\n"),
    );
    process.exitCode = 1;
  } else {
    try {
      const identity = scaffoldPlanIdentity(specsDir, mode);
      console.log(`fileName=${identity.fileName}`);
      // Printed only when the branch actually returned one — the key is
      // structurally absent on the tracker branches, and an `id=` line there
      // would report a value step 8 must not write.
      if (identity.id !== undefined) console.log(`id=${identity.id}`);
      console.log(`plan=${specsDir}/plan/${identity.fileName}`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}

// mintMilestoneId — STE-417 AC-STE-417.4: the `mode: none` milestone-id
// allocator.
//
// Tracker-less projects have no Epic key to derive a milestone id from, so
// they MINT one: `mintUniqueId` from `ulid.ts` produces the full 29-char
// `fr_`-prefixed value (stored verbatim in plan frontmatter as `id:`) and
// `milestoneIdFromUlid` derives the `M_<6-char tail>` token that names the
// plan file. This deliberately BYPASSES the sequential `nextFreeMilestoneNumber`
// five-way scan: minted ids are opaque, so there is no counter to advance and
// nothing for a concurrent branch to race over.
//
// Why the uniqueness predicate exists: the derived token keeps only 6 of the
// minted id's 26 characters, so distinct ULIDs CAN land on the same tail.
// Without a probe, a second mint could name a plan file that already exists
// and a later write would silently overwrite someone's milestone. The
// predicate therefore probes BOTH `<specsDir>/plan/M_<tail>.md` and
// `<specsDir>/plan/archive/M_<tail>.md` — archived plans still own their id.
//
// The predicate receives the FULL minted id (that is `mintUniqueId`'s
// documented contract — it never hands over a derived tail) and does the
// derivation itself, so only real plan filenames count as collisions.
// `mintUniqueId`'s 3-attempt budget is reused verbatim; three consecutive
// collisions throw rather than return a clobbering id.
//
// Minting is PURE: it names a plan file, it never creates one. The caller
// writes the plan.

import { existsSync } from "node:fs";
import { join } from "node:path";
import { milestoneIdFromUlid } from "./milestone_token";
import { mintUniqueId } from "./ulid";

/** A freshly minted tracker-less milestone identity. */
export interface MintedMilestoneId {
  /** The full 29-char `fr_`-prefixed minted id, stored in plan frontmatter. */
  id: string;
  /** `M_<tail>` — the derived milestone token that names the plan file. */
  milestoneId: string;
}

/**
 * Mint a milestone id whose derived `M_<tail>` token does not already name a
 * plan file under `<specsDir>/plan/` or `<specsDir>/plan/archive/`.
 *
 * Synchronous by design: `mintUniqueId`'s `exists` predicate must be
 * synchronous (an async predicate would return a truthy Promise and defeat
 * the collision retry), so the probe uses `existsSync`. A missing plan tree
 * is not a collision — nothing is taken yet.
 *
 * Throws (from `mintUniqueId`) after 3 consecutive tail collisions.
 */
export function mintMilestoneId(specsDir: string): MintedMilestoneId {
  const planDir = join(specsDir, "plan");
  const archiveDir = join(planDir, "archive");

  const id = mintUniqueId({
    exists: (candidate) => {
      const planFile = `${milestoneIdFromUlid(candidate)}.md`;
      return existsSync(join(planDir, planFile)) || existsSync(join(archiveDir, planFile));
    },
  });

  return { id, milestoneId: milestoneIdFromUlid(id) };
}

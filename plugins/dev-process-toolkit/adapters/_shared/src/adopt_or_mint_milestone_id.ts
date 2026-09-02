// adopt_or_mint_milestone_id — STE-538 AC-STE-538.1: `/spec-write`'s
// tracker-less branch ADOPTS the identity `/setup` already recorded on the
// bootstrap plan, and mints a fresh one only when there is nothing to adopt.
//
// THE DEFECT. Since STE-537, `/setup` step 8 under `mode: none` mints a
// milestone identity and names the bootstrap plan after it
// (`specs/plan/M_<tail>.md`, recording the full `fr_`-prefixed value as `id:`).
// `/spec-write` then minted a SECOND identity and renamed that plan from one
// opaque name to another — for nothing — leaving the identity recorded INSIDE
// the file disagreeing with the one that named it until `consumeScaffoldPlan`
// overwrote it. Both mints produce well-formed output, so the duplicate mint is
// invisible on disk; adoption is the only way to make it not happen.
//
// WHY THE KIND, NOT THE `id:`. Eligibility is decided by `findScaffoldPlan`,
// which discriminates on `kind: scaffolding` frontmatter. A `kind: legacy` plan
// is one the operator has deliberately opted out of identity policing — its
// `id:`, however well-formed, is not ours to adopt. Keying on the mere presence
// of an `id:` would silently annex it.
//
// WHY THE SHAPE CHECK. `milestoneIdFromUlid` throws on anything outside
// `ULID_REGEX`. Adopting a malformed recorded value would turn a repairable
// frontmatter typo into a hard crash inside `/spec-write`'s allocation gate, so
// a recorded id that does not match the grammar falls through to a fresh mint.
//
// PURITY. This module only READS. Renaming and rewriting the scaffold belong to
// `consumeScaffoldPlan`; if adoption also touched the file the two would have to
// agree about ordering forever after.
//
// THE `mint` SEAM. The second parameter defaults to the real `mintMilestoneId`,
// so production call sites pass one argument and behave exactly as before. It
// exists because a second mint leaves no trace in the outcome — the only
// falsifiable form of "it did not mint twice" is a counter on the minter.
//
// `findScaffoldPlan` THROWS when more than one active plan declares
// `kind: scaffolding`. That refusal is inherited deliberately: picking one
// arbitrarily is the ambiguous-identity state the scaffold machinery exists to
// close, and it must not be silently resolved here either.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { findScaffoldPlan } from "./consume_scaffold_plan";
import { parseFrontmatter } from "./frontmatter";
import { milestoneIdFromUlid } from "./milestone_token";
import type { MintedMilestoneId } from "./mint_milestone_id";
import { mintMilestoneId } from "./mint_milestone_id";
import { ULID_REGEX } from "./ulid";

/** The allocator seam — `mintMilestoneId`'s shape, injectable for tests. */
export type MilestoneMinter = (specsDir: string) => MintedMilestoneId;

/**
 * The well-formed minted `id:` recorded on the single eligible scaffold plan
 * under `<specsDir>/plan/`, or `null` when there is nothing adoptable.
 *
 * Null covers all three of: no scaffold at all, a scaffold with no `id:`, and a
 * scaffold whose `id:` is malformed. Every one of them means "mint".
 *
 * Read through `parseFrontmatter(raw, { lenient: true })` — the same reader
 * `findScaffoldPlan` uses — so a CRLF- or BOM-prefixed scaffold resolves its
 * keys like any other, and a plan with no frontmatter block reports absence
 * rather than throwing.
 */
function recordedScaffoldId(specsDir: string): string | null {
  const scaffold = findScaffoldPlan(specsDir);
  if (scaffold === null) return null;

  let raw: string;
  try {
    raw = readFileSync(scaffold, "utf-8");
  } catch {
    return null;
  }

  const id = parseFrontmatter(raw, { lenient: true })["id"];
  if (typeof id !== "string") return null;

  const trimmed = id.trim();
  return ULID_REGEX.test(trimmed) ? trimmed : null;
}

/**
 * Adopt the milestone identity already recorded on `/setup`'s bootstrap plan,
 * or mint a fresh one.
 *
 * Adopts when EXACTLY ONE active plan under `<specsDir>/plan/` declares
 * `kind: scaffolding` and records a well-formed minted `id:` — the returned
 * pair is that verbatim id plus the token re-derived from it, never a token
 * from some other mint. Otherwise delegates to `mint`.
 *
 * Pure: nothing on disk is created, renamed or rewritten.
 *
 * Throws (from `findScaffoldPlan`) when more than one active plan declares
 * `kind: scaffolding`.
 */
export function adoptOrMintMilestoneId(
  specsDir: string,
  mint: MilestoneMinter = mintMilestoneId,
): MintedMilestoneId {
  const adopted = recordedScaffoldId(specsDir);
  if (adopted !== null) return { id: adopted, milestoneId: milestoneIdFromUlid(adopted) };
  return mint(specsDir);
}

// ---------------------------------------------------------------------------
// Command-line entry point
// ---------------------------------------------------------------------------
//
// WHY IT EXISTS. `/spec-write`'s tracker-less branch ORDERS this module by name
// (`skills/spec-write/SKILL.md`), and an order addressed to a reader has to be
// runnable BY that reader — a module named in shipped prose with no front door
// is precisely the unreachable-order class /gate-check probe #81 exists to
// catch.
//
//   bun run adapters/_shared/src/adopt_or_mint_milestone_id.ts specs
//   path=adopted
//   id=fr_01K4Q8V2N3PXR7ZQ4KD5MBWTGE
//   milestoneId=M_7ZQ4KD
//   plan=specs/plan/M_7ZQ4KD.md
//
// `path=` IS THE POINT. Both branches return a well-formed pair, so adoption and
// a fresh mint are indistinguishable in the output alone — which is the very
// invisibility this module was written to end (a second mint leaves no trace in
// the outcome). It is MEASURED, not re-derived: the `mint` seam is wrapped and
// the flag is set by the minter actually being called, so the printed word
// cannot disagree with what happened. Re-running `recordedScaffoldId` here to
// decide the label would report the rule rather than the run.
//
// The multi-scaffold refusal from `findScaffoldPlan` SURFACES — its message on
// stderr, non-zero exit — and is never swallowed: picking one scaffold
// arbitrarily is the ambiguous-identity state this machinery exists to close, so
// a door that printed some id anyway would resolve at the door what the module
// deliberately refuses to resolve.
//
// Reading only: no plan is renamed or rewritten here, exactly as in the exported
// function — `consumeScaffoldPlan` owns that. `import.meta.main` is false on
// import, so the module stays side-effect-free for `/spec-write` and for tests.
if (import.meta.main) {
  const specsDir = resolve(process.argv[2] ?? "specs");

  try {
    let mintedFresh = false;
    const resolved = adoptOrMintMilestoneId(specsDir, (dir) => {
      mintedFresh = true;
      return mintMilestoneId(dir);
    });
    console.log(`path=${mintedFresh ? "minted" : "adopted"}`);
    console.log(`id=${resolved.id}`);
    console.log(`milestoneId=${resolved.milestoneId}`);
    console.log(`plan=${specsDir}/plan/${resolved.milestoneId}.md`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

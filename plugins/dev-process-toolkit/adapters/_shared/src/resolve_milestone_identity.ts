// resolve_milestone_identity — STE-440 AC-STE-440.1..4: ONE milestone-identity
// dispatcher for /spec-write's milestone-allocation gate.
//
// /spec-write used to carry three per-mode allocation branches as prose. Prose
// branches drift: a mode that quietly fell through to the sequential allocator
// named a plan file `M<N>` in a tracker-less project, and nothing downstream
// could tell that apart from a deliberate allocation. This module makes the
// choice a `switch` instead of a paragraph.
//
// It is a THIN ROUTER, not a reimplementation. Each branch delegates to the
// helper that owns that mode today, so all three keep their current semantics
// AND their current tests:
//
//   mode: linear → `nextFreeMilestoneNumber` (next_free_milestone_number.ts)
//                  the five-way scan: active plans, archived plans, CHANGELOG,
//                  tracker milestones, git branches. Every optional scan input
//                  is forwarded verbatim — dropping one silently demotes the
//                  five-way scan to a two-way one while still returning a
//                  plausible `M<N>`.
//   mode: jira   → `milestoneIdFromEpicKey` (milestone_token.ts)
//                  Epic-first derivation, `PROJ-500` → `M_PROJ_500`. Its
//                  never-a-silent-bad-id contract survives the dispatch: an
//                  unsanitizable key throws rather than returning a bad token.
//   mode: none   → `adoptOrMintMilestoneId` (adopt_or_mint_milestone_id.ts)
//                  ADOPT the identity `/setup` step 8 already recorded on the
//                  bootstrap plan, falling back to the collision-guarded
//                  `mintMilestoneId` when there is nothing adoptable (STE-538).
//                  This branch is the only one that produces an `id`, and it is
//                  STRUCTURALLY incapable of emitting a sequential `M<N>`:
//                  neither the adopted nor the minted half consults the scan.
//
// The return type is one interface with an optional `id` rather than three
// shapes, so the call site is a single destructure. `id` is present ONLY on
// the `mode: none` branch — probe #73 fails any tracker-mode plan carrying an
// `id:` line, so the tracker branches must omit the key, not merely leave it
// empty.
//
// Async because the linear branch delegates to the async five-way scan; the
// Epic and mint branches resolve immediately.
//
// Ordering contract (preserved verbatim from the prose it replaces): the
// dispatcher runs BEFORE any plan or FR file is written, because the
// tracker-less branch determines the plan filename.

import { adoptOrMintMilestoneId, type MilestoneMinter } from "./adopt_or_mint_milestone_id";
import { milestoneIdFromEpicKey } from "./milestone_token";
import {
  nextFreeMilestoneNumber,
  type BranchMilestoneScanner,
  type MilestoneListingProvider,
} from "./next_free_milestone_number";

/** The three milestone-identity modes, keyed off `Task Tracking → mode`. */
export type MilestoneIdentityMode = "linear" | "jira" | "none";

/** Inputs to the dispatcher. Only `specsDir` + `mode` are always meaningful. */
export interface ResolveMilestoneIdentityInput {
  /** Project `specs/` directory — the root of the plan tree. */
  specsDir: string;
  /** Which allocation branch to take. */
  mode: MilestoneIdentityMode;
  /** Tracker-assigned Epic key. Read by the `jira` branch only. */
  epicKey?: string;
  /**
   * Optional five-way-scan inputs, forwarded verbatim on the `linear` branch.
   * They are NOT new behavior — omitting them here would silently demote the
   * five-way scan to a two-way one (active + archived plans), which is exactly
   * the defect AC-STE-440.3's equality assertions catch.
   */
  changelogPath?: string;
  provider?: MilestoneListingProvider;
  branchScanner?: BranchMilestoneScanner;
  /**
   * Optional allocator seam, forwarded verbatim on the `none` branch — the same
   * kind of injection point as `provider` / `branchScanner` above, and defaulted
   * the same way (omit it and `adoptOrMintMilestoneId` falls back to the real
   * `mintMilestoneId`). It exists because a SECOND mint leaves no trace in the
   * outcome: both mints produce a well-formed `M_<tail>` carrying a well-formed
   * `id:` the name derives, so the only falsifiable form of "it minted once" is
   * a counter on an injected minter — and a counter the dispatcher never reaches
   * measures nothing.
   */
  minter?: MilestoneMinter;
}

/** A resolved milestone identity. `id` is present on the `none` branch only. */
export interface MilestoneIdentity {
  /** The milestone token that names the plan file: `M102` / `M_PROJ_500` / `M_0K0K0K`. */
  milestoneId: string;
  /** The full minted `fr_`-prefixed id, written to plan frontmatter. `mode: none` only. */
  id?: string;
}

/**
 * The canonical `requireOrRefuse` gate-site identifier for the
 * milestone-allocation decision (AC-STE-440.4).
 *
 * All three modes share this ONE site. The prior design routed every branch
 * through a single `requireOrRefuse` call precisely so no branch could bypass
 * the gate; an off-gate branch is the silent no-op the gate exists to prevent.
 */
export const MILESTONE_ALLOCATION_GATE_SITE = "milestone-allocation";

/** The per-mode inputs to the ONE milestone-allocation `requireOrRefuse` call. */
export interface MilestoneAllocationGateSpec {
  /** Always {@link MILESTONE_ALLOCATION_GATE_SITE} — identical across modes. */
  gateSite: string;
  /** The `defaultValue` slot: the resolved milestone token, and nothing else. */
  defaultValue: string;
  /** The full identity, so the `mode: none` `id` reaches plan frontmatter. */
  identity: MilestoneIdentity;
}

/**
 * Resolve the milestone identity for one project + mode.
 *
 * Dispatches to the helper that owns the mode and returns its answer
 * unchanged. Throws on an unknown mode rather than falling through to the
 * sequential allocator — a fall-through would name a tracker-less plan file
 * `M<N>` and read as a deliberate allocation forever after.
 */
export async function resolveMilestoneIdentity(
  input: ResolveMilestoneIdentityInput,
): Promise<MilestoneIdentity> {
  switch (input.mode) {
    case "linear": {
      const availability = await nextFreeMilestoneNumber(
        input.specsDir,
        input.changelogPath,
        input.provider,
        input.branchScanner,
      );
      // No `id` KEY at all — probe #73 fails a tracker-mode plan carrying one.
      return { milestoneId: `M${availability.next}` };
    }
    case "jira": {
      // `?? ""` routes a missing key into the sanitizer's own refusal rather
      // than a `TypeError` — one never-a-silent-bad-id contract, not two.
      return { milestoneId: milestoneIdFromEpicKey(input.epicKey ?? "") };
    }
    case "none": {
      // Adoption first, minting only when there is nothing to adopt. Either
      // way ONE allocator owns both halves of the identity; an `epicKey`
      // supplied here is IGNORED by construction, never used to derive the
      // token. The branch's contract is unchanged: it is the only one that
      // returns an `id` key.
      const minted = adoptOrMintMilestoneId(input.specsDir, input.minter);
      return { milestoneId: minted.milestoneId, id: minted.id };
    }
    default: {
      const unknown: never = input.mode;
      throw new Error(
        `resolveMilestoneIdentity: unknown milestone-identity mode ${JSON.stringify(unknown)}; ` +
          `expected one of "linear" | "jira" | "none"`,
      );
    }
  }
}

/**
 * Build the inputs for the ONE milestone-allocation `requireOrRefuse` call
 * (AC-STE-440.4).
 *
 * The dispatcher sits INSIDE the gate call's `defaultValue` computation, not
 * around it: `gateSite` is mode-independent and `defaultValue` is exactly the
 * resolved milestone token, so the three modes are indistinguishable at the
 * gate except for the value they recommend. The caller passes `defaultValue`
 * into `requireOrRefuse`'s `defaultValue` slot (marker present ⇒ default-apply
 * and emit `milestone_allocation_default_applied`; marker absent + non-tty ⇒
 * `RequiresInputRefusedError`) and writes `identity.id`, when present, into the
 * plan's frontmatter.
 */
export async function milestoneAllocationGateSpec(
  input: ResolveMilestoneIdentityInput,
): Promise<MilestoneAllocationGateSpec> {
  const identity = await resolveMilestoneIdentity(input);
  return {
    gateSite: MILESTONE_ALLOCATION_GATE_SITE,
    defaultValue: identity.milestoneId,
    identity,
  };
}

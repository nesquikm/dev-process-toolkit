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
//   mode: linear → `mintMilestoneLinear` (mint_milestone_linear.ts)
//                  TRACKER-FIRST (STE-541): create the project milestone under
//                  the human title, read the identifier the tracker allocates
//                  back, and derive the milestone id from it. The identity is
//                  the tracker's answer, not a sequential number this branch
//                  computed for itself — so two projects, two clones, or two
//                  concurrent sessions cannot mint the same token. The branch
//                  no longer consults `nextFreeMilestoneNumber`'s five-way scan
//                  at all; that allocator keeps its own front door for the
//                  explicit-`M<N>` collision check.
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
// Async because the linear branch delegates to the async tracker mint; the
// Epic and mint branches resolve immediately.
//
// Ordering contract (preserved verbatim from the prose it replaces): the
// dispatcher runs BEFORE any plan or FR file is written, because the
// tracker-less branch determines the plan filename.

import { adoptOrMintMilestoneId, type MilestoneMinter } from "./adopt_or_mint_milestone_id";
import { milestoneIdFromEpicKey } from "./milestone_token";
import {
  mintMilestoneLinear,
  type MintMilestoneLinearProvider,
} from "./mint_milestone_linear";
// TYPE-ONLY on purpose. The linear branch no longer calls the five-way scan,
// so this module is no longer one of its importers (probe #81 pins that list
// empty); the allocator's shapes stay referenced here only because the input
// interface still ACCEPTS its optional scan seams from existing callers.
import type {
  BranchMilestoneScanner,
  MilestoneListingProvider,
} from "./next_free_milestone_number";

/** The three milestone-identity modes, keyed off `Task Tracking → mode`. */
export type MilestoneIdentityMode = "linear" | "jira" | "none";

/** Inputs to the dispatcher. `mode` is the only one every branch reads. */
export interface ResolveMilestoneIdentityInput {
  /**
   * Project `specs/` directory — the root of the plan tree. Read by the `none`
   * branch alone since STE-541 took the five-way scan off the `linear` branch;
   * still required, because that branch cannot be typed away per-mode.
   */
  specsDir: string;
  /** Which allocation branch to take. */
  mode: MilestoneIdentityMode;
  /** Tracker-assigned Epic key. Read by the `jira` branch only. */
  epicKey?: string;
  /**
   * The tracker project the milestone is minted in. Read by the `linear`
   * branch only — `mintMilestoneLinear` cannot create without it.
   */
  project?: string;
  /**
   * The HUMAN milestone title. Read by the `linear` branch only, and the only
   * name that exists at create time: the canonical `M_<id> — <Title>` name is
   * not knowable until the tracker has allocated the identifier it derives
   * from.
   */
  title?: string;
  /**
   * The tracker milestone provider. On the `linear` branch this is the mint's
   * provider and MUST carry the milestone-create op; the type is widened past
   * `MilestoneListingProvider` — which cannot express `createMilestone` —
   * precisely so such a provider is accepted here.
   */
  provider?: MilestoneListingProvider | MintMilestoneLinearProvider;
  /**
   * Vestigial five-way-scan seams, accepted so existing callers keep type-
   * checking. Since STE-541 the `linear` branch mints instead of scanning, so
   * NOTHING reads these — AC-STE-541.1 asserts exactly that, as a call count of
   * zero on an injected `branchScanner`.
   */
  changelogPath?: string;
  branchScanner?: BranchMilestoneScanner;
  /**
   * Optional allocator seam, forwarded verbatim on the `none` branch — the same
   * kind of injection point as `provider` above (NOT `branchScanner`, which is
   * vestigial since STE-541 and reaches nothing), and defaulted the same way
   * (omit it and `adoptOrMintMilestoneId` falls back to the real
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
      // TRACKER-FIRST. The identity is whatever the tracker allocated, derived
      // by the mint itself — never a number this branch computed. `?? {}`
      // routes a missing provider into `mintMilestoneLinear`'s own create-op
      // refusal rather than a `TypeError` on the destructure.
      //
      // The project and the title are guarded HERE, before the mint, and the
      // asymmetry with the `jira` branch is the reason. An earlier version of
      // this comment claimed `?? ""` gave "the same one-refusal-not-two shape
      // the jira branch uses" — that was false in the one direction that
      // matters. `milestoneIdFromEpicKey("")` THROWS, so an empty Epic key
      // costs nothing; `mintMilestoneLinear(p, "", "")` CREATES, so an empty
      // title silently allocated a real tracker milestone named "" in a
      // project named "" and returned a well-formed id derived from it. A
      // defaulted empty string is harmless in front of a sanitizer and is an
      // outward WRITE in front of a mint. Refusing here also makes the
      // in-process route agree with this module's own CLI front door, which
      // has always refused exactly this argv.
      const project = input.project ?? "";
      const title = input.title ?? "";
      if (project === "" || title === "") {
        throw new Error(
          `resolveMilestoneIdentity: refusing to mint a Linear milestone without a project and a human title ` +
            `(project=${JSON.stringify(project)}, title=${JSON.stringify(title)}). ` +
            `The tracker-first route CREATES the milestone before deriving its id, so a missing value here is a ` +
            `write, not a bad read: it would allocate a real milestone under an empty name and return an id ` +
            `derived from it. Supply both, or use mode "jira" / "none" if no tracker milestone should be created.`,
        );
      }
      const minted = await mintMilestoneLinear(input.provider ?? {}, project, title);
      // No `id` KEY at all — probe #73 fails a tracker-mode plan carrying one.
      return { milestoneId: minted.milestoneId };
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

// STE-539 AC-STE-539.1 — minting a Linear project milestone, in the only order
// that is computable.
//
// The canonical milestone name is `M_<id> — <Title>`, and `<id>` is derived
// from the identifier the tracker allocates for THIS milestone. At creation
// time that identifier does not exist yet, so "create the milestone under its
// canonical name" asks for a value only the call it would be an argument to can
// produce.
//
// What IS computable before the create is the human title. So the order is the
// Jira path's order — the one `mint_milestone_epic.ts` already runs:
//
//   1. create with `name=<human title>`,
//   2. read the allocated identifier back, verbatim,
//   3. derive the milestone id from it via `milestoneIdFromLinearMilestone`,
//   4. (caller) write the plan file under that id.
//
// The identity therefore comes from the tracker, never from the sequential
// five-way scan the dispatcher's Linear branch used to run — that branch
// delegates HERE now, and the scan's module keeps only the hand-typed-`M<N>`
// collision check. This module neither imports that scan nor consults its
// allocator (AC-STE-539.6).
//
// This module owns steps 1–3 and is the single production call site of the
// milestone-create op (AC-STE-539.5).

import type { MilestoneOps } from "./attach_project_milestone";
import { defaultSleep, retryTransient } from "./attach_project_milestone";
import { printable } from "./tracker_receipts";
import {
  approvedMintMismatchRefusal,
  matchMilestoneTitle,
  type MilestoneMintDecision,
  milestoneIdFromLinearMilestone,
  normalizeMilestoneTitle,
  reconcileApprovedMint,
} from "./milestone_token";

/**
 * The ops a mint uses: the milestone creator, plus the OPTIONAL enumeration op
 * the find leg needs.
 *
 * Declared here rather than `Pick`-ed off `MilestoneOps` on purpose: that
 * interface's `listMilestones` is REQUIRED, and a `Pick` would force every
 * caller of the mint to carry an enumeration op this contract treats as
 * optional. A provider holding only the creator mints fine — it simply has no
 * find leg. The op SHAPES are the ones `MilestoneOps` declares (see
 * `createMilestone` there), so the two surfaces cannot drift apart silently.
 */
export interface MintMilestoneLinearProvider {
  createMilestone?: MilestoneOps["createMilestone"];
  listMilestones?: (project: string) => Promise<{ name: string; id?: string }[]>;
}

/**
 * Injected wait for the canonical backoff schedule (tests pass a recorder).
 * Absent ⇒ the SHARED `defaultSleep` imported above, not a local copy of it.
 */
export interface MintMilestoneLinearOptions {
  sleep?: (ms: number) => Promise<void>;
  /**
   * STE-586 — JOIN mode: bind to an existing milestone, never create one. A
   * find leg with no normalized match refuses instead of minting.
   */
  join?: boolean;
  /**
   * STE-608 — the APPROVED decision. When present, the find leg consults
   * `decideMilestoneMint` over the enumerated milestones instead of a bare
   * title match, so a join by key binds that identifier whatever its title.
   */
  expect?: MilestoneMintDecision;
}

/** The pair a mint yields: the tracker's identifier, and the id derived from it. */
export interface MintedMilestoneLinear {
  /** Verbatim, exactly as the tracker allocated it (a UUID). */
  milestoneUuid: string;
  /** `milestoneIdFromLinearMilestone(milestoneUuid)` (`M_550e84`). */
  milestoneId: string;
  /**
   * STE-608 — whether this call created the milestone or joined an existing
   * one. `created` when this call's create ran (including a retry whose find
   * leg found the create an earlier attempt of THIS call landed); `joined`
   * when the find leg bound an existing milestone before any create.
   */
  readonly outcome: "created" | "joined";
}

/**
 * Mint the project milestone for `project` under the human `title`, and return
 * both the tracker-assigned identifier and the milestone id derived from it.
 *
 * The creation name is the title ALONE — never the canonical
 * `M_<id> — <Title>` name, which is not knowable until this call returns.
 *
 * An identifier that will not derive a well-formed `M_<key>` id propagates
 * `milestoneIdFromLinearMilestone`'s own refusal rather than a locally
 * re-worded guard that could drift from the derivation it protects — so the
 * milestone exists but no malformed id is ever returned.
 */
export async function mintMilestoneLinear(
  provider: MintMilestoneLinearProvider,
  project: string,
  title: string,
  opts?: MintMilestoneLinearOptions,
): Promise<MintedMilestoneLinear> {
  const { createMilestone, listMilestones } = provider;
  if (!createMilestone) {
    throw new Error(
      "mintMilestoneLinear: minting a project milestone requires a milestone-create op on the provider",
    );
  }
  // STE-586 AC-STE-586.10 — a join is a FIND, and a provider with no
  // enumerator cannot find. Refused here, before `retryTransient`: without
  // this guard the missing find leg would fall straight through to the create
  // a join must never make. Zero lists, zero creates, zero sleeps.
  // STE-608 — an APPROVED join (`expect` act join) is a find too: without
  // this, a provider with no enumerator fell through both find branches to the
  // single create below.
  if ((opts?.join || opts?.expect?.act === "join") && !listMilestones) {
    throw new Error(
      [
        `Refusing: to join project milestone "${title}" in project ${project} — a join cannot look for the existing milestone because the provider carries no listMilestones operation.`,
        "Remedy: give the provider its listMilestones op so the join can find the milestone the first repo minted — a join never creates.",
        "Context: mode=linear, phase=project-milestone-mint, join=true, missing_op=listMilestones",
      ].join("\n"),
    );
  }
  // STE-586 AC-STE-586.12 — a title that normalizes to empty names nothing:
  // the find leg would compare against "" and the create would mint a
  // milestone with a blank name. Refused here, before `retryTransient`. Zero
  // lists, zero creates, zero sleeps.
  const normalized = normalizeMilestoneTitle(title);
  if (normalized === "") {
    throw new Error(
      [
        `Refusing: to mint a project milestone in project ${project} whose title is empty once whitespace is normalized.`,
        "Remedy: pass the human title the project milestone should carry.",
        "Context: mode=linear, phase=project-milestone-mint, title=empty",
      ].join("\n"),
    );
  }
  const sleep = opts?.sleep ?? defaultSleep;

  // AC-STE-539.5 — steps 1–2 retry as ONE unit on the canonical STE-362
  // schedule (imported, never re-declared), and the find leg runs INSIDE that
  // unit. A create that registers server-side and then times out is therefore
  // FOUND on the retry and reused; a blind re-create would mint the duplicate
  // milestone this contract exists to prevent. The single milestone-create
  // invocation is a LOOP body, not a second copy, so the op keeps exactly one
  // production call site. The success path waits zero times — `sleep` fires
  // only after a caught error.
  //
  // `null` is the one non-identifier outcome the round trip can report: a
  // milestone found by NAME whose enumerated row carries no identifier. It is
  // returned rather than thrown because it is PERMANENT — re-listing three
  // more times cannot conjure an identifier, and creating anyway would mint
  // the duplicate. The refusal is raised outside the retry, below.
  //
  // STE-586 — two or more milestones whose names normalize equal are
  // AMBIGUOUS, and permanent for the same reason, so they too leave the retry
  // as a value and are refused once, below.
  //
  // STE-586 — under `{ join: true }` a find leg with ZERO normalized matches
  // is equally permanent, so it too leaves the retry as a value and is refused
  // once, below. It is a GUARD in front of the single create, not a second
  // path around it.
  // STE-608 — a hit found AFTER a create was attempted is that create landing
  // server-side before a timeout: the act performed is still a create.
  let createAttempted = false;
  const expected = opts?.expect;
  const outcome = await retryTransient<
    string | null | { ambiguous: { name: string; id?: string }[] } | { joinMiss: true } | { mismatch: string | null }
  >(async () => {
    // STE-608 — this paragraph describes the find leg WITHOUT an approved
    // decision; with one (`expect`), the first branch below decides instead.
    // The find leg matches by NAME: at mint time no identifier exists to match
    // on. It runs on the FIRST attempt as well as on retries, which makes
    // minting IDEMPOTENT — re-running a mint after a crash, a resumed session,
    // or an operator repeating a step reuses the milestone instead of creating
    // a second one. Moving this into the retry's failure path would restore
    // duplicate minting on exactly the re-run an operator is most likely to
    // make. `listMilestones` is optional; without it a mint has no find leg.
    // STE-586 — the name match is NORMALIZED on both sides
    // (`matchMilestoneTitle`), so a stray space or case difference joins the
    // existing milestone instead of minting a twin. The create below still
    // receives the RAW title.
    if (listMilestones && expected) {
      // STE-608 AC-STE-608.1 + .8 — with an approved decision the find leg is
      // the ONE decision (`decideMilestoneMint`, via `reconcileApprovedMint`),
      // never a local re-derivation: a join by key binds that identifier
      // whatever its title, and any act other than the approved one leaves
      // the retry as a mismatch, refused once below.
      const rows = await listMilestones(project);
      const found = reconcileApprovedMint({ mode: "linear", project, rows }, title, expected, createAttempted);
      if (found !== null) return found;
    } else if (listMilestones) {
      const matches = matchMilestoneTitle(await listMilestones(project), title);
      if (matches.length > 1) return { ambiguous: matches };
      if (matches.length === 1) return matches[0]!.id ?? null;
      if (opts?.join) return { joinMiss: true };
    }
    // Step 1 — the name is the title, the only value that exists yet.
    // Step 2 — read the identifier back, verbatim.
    createAttempted = true;
    return (await createMilestone(project, { name: title })).id;
  }, sleep);

  if (outcome !== null && typeof outcome !== "string" && "mismatch" in outcome) {
    throw approvedMintMismatchRefusal({
      mode: "linear",
      phase: "project-milestone-mint",
      container: "project milestone",
      noun: "milestone",
      title,
      project,
      // A mismatch is only ever returned by the approved-decision find leg.
      expected: expected!,
      found: outcome.mismatch,
    });
  }
  if (outcome !== null && typeof outcome !== "string" && "joinMiss" in outcome) {
    throw new Error(
      [
        `Refusing: to join project milestone "${title}" in project ${project} — no existing milestone matches it (normalized "${normalized}").`,
        "Remedy: check the title against the milestone the first repo minted, or mint it from that repo — a join never creates.",
        `Context: mode=linear, phase=project-milestone-mint, join=true, normalized=${normalized}`,
      ].join("\n"),
    );
  }
  if (outcome !== null && typeof outcome !== "string" && "ambiguous" in outcome) {
    const candidates = outcome.ambiguous
      .map((m) => `${m.id ?? "<no identifier>"} "${m.name}"`)
      .join(", ");
    throw new Error(
      [
        `Refusing: to mint project milestone "${title}" in project ${project} — ${outcome.ambiguous.length} existing milestones normalize to the same title: ${candidates}.`,
        "Remedy: rename one of them in the tracker so their titles no longer normalize equal, then re-run the mint; to bind a specific one, join by its milestone identifier instead of by title.",
        `Context: mode=linear, phase=project-milestone-mint, normalized=${normalized}`,
      ].join("\n"),
    );
  }
  const milestoneUuid = outcome;

  if (milestoneUuid === null) {
    throw new Error(
      `mintMilestoneLinear: project "${project}" already holds a milestone named "${title}", but the enumeration carried no identifier for it — refusing rather than minting a duplicate`,
    );
  }

  // Step 3 — derive the id from the identifier; refusals propagate.
  // Deliberately OUTSIDE the retry: an identifier that will not derive is
  // permanent, and paying the backoff schedule for it would create the
  // milestone three more times.
  const milestoneId = milestoneIdFromLinearMilestone(milestoneUuid);

  // A found identifier before any create is a join; anything else a create.
  return { milestoneUuid, milestoneId, outcome: createAttempted ? "created" : "joined" };
}

// ---------------------------------------------------------------------------
// Command-line entry point
// ---------------------------------------------------------------------------
//
// The create itself is an MCP call only the session can make, so the front
// door takes the identifier that call ALLOCATED and puts it through the very
// same `mintMilestoneLinear` contract the route uses: the name that had to be
// sent is echoed back (the human title alone, read off the recorded creation
// argument — not re-composed here), the identifier is read back verbatim, and
// the id is derived. An identifier that will not sanitize refuses at this door
// exactly as it refuses in the route, so a malformed `M_` id can never reach a
// plan filename.
//
//   bun run adapters/_shared/src/mint_milestone_linear.ts "DPT" "Tracker-First Linear Milestones" 550e8400-e29b-41d4-a716-446655440000
//   name=Tracker-First Linear Milestones
//   milestoneUuid=550e8400-e29b-41d4-a716-446655440000
//   milestoneId=M_550e84
//   plan=specs/plan/M_550e84.md
//   outcome=created
//
// `import.meta.main` is false on import, so the module stays side-effect free
// for the route that consumes it.
if (import.meta.main) {
  const project = process.argv[2];
  const title = process.argv[3];
  const allocatedUuid = process.argv[4];

  if (project === undefined || title === undefined || allocatedUuid === undefined) {
    console.error(
      [
        "Refusing: to mint a project milestone without a project, a human title and the identifier the tracker allocated.",
        "Remedy: bun run adapters/_shared/src/mint_milestone_linear.ts <project> <title> <allocated-uuid>",
        "Context: mode=linear, phase=project-milestone-mint, argv=incomplete",
      ].join("\n"),
    );
    process.exitCode = 1;
  } else {
    // The name is READ OFF the creation argument the helper actually sent,
    // never re-derived from `title` here — a front door that printed its own
    // input would report the rule rather than measure it.
    let sentName: string | null = null;
    try {
      const minted = await mintMilestoneLinear(
        {
          createMilestone: async (_project: string, opts: { name: string }) => {
            sentName = opts.name;
            return { id: allocatedUuid };
          },
        },
        project,
        title,
      );
      console.log(printable(`name=${sentName ?? ""}`));
      console.log(`milestoneUuid=${minted.milestoneUuid}`);
      console.log(`milestoneId=${minted.milestoneId}`);
      console.log(`plan=specs/plan/${minted.milestoneId}.md`);
      console.log(`outcome=${minted.outcome}`);
    } catch (error) {
      // One printable line per refusal line: echoed titles cannot start a new one.
      const message = error instanceof Error ? error.message : String(error);
      console.error(message.split("\n").map(printable).join("\n"));
      process.exitCode = 1;
    }
  }
}

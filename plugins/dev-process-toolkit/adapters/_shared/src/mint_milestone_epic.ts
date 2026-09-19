// STE-522 AC-STE-522.1 — minting a milestone Epic, in the only order that is
// computable.
//
// The canonical milestone name is `M_<key> — <Title>`, and `<key>` is the key
// the tracker allocates for THIS Epic. At creation time it does not exist yet,
// so "create the Epic with the canonical name" asks for a value that only the
// call it is an argument to can produce.
//
// What IS computable before the create is the human title. So the order is:
//
//   1. create with `summary=<human title>` (the `name` op arg),
//   2. read the allocated key back,
//   3. derive the milestone id from it via `milestoneIdFromEpicKey`,
//   4. (caller) write the plan file under that id.
//
// This module owns step 1–3 and is the single production call site of the
// `createEpic` op (AC-STE-522.8).

import type { MilestoneOps } from "./attach_project_milestone";
import { defaultSleep, mergeMilestoneLabel, milestoneLabel, retryTransient } from "./attach_project_milestone";
import {
  approvedMintMismatchRefusal,
  type JiraDecisionRow,
  matchMilestoneTitle,
  type MilestoneMintDecision,
  milestoneIdFromEpicKey,
  normalizeMilestoneTitle,
  reconcileApprovedMint,
} from "./milestone_token";
import { printable } from "./tracker_receipts";

/**
 * The ops a mint uses: the Epic creator declared on `MilestoneOps`, plus the
 * OPTIONAL enumeration op the retry's find leg needs, plus the OPTIONAL label
 * op that writes the milestone label on the minted Epic. All three are
 * optional on `MilestoneOps` itself, so a provider that carries only
 * `createEpic` still satisfies this type — it just mints without a find leg
 * and without a label.
 */
export type MintMilestoneEpicProvider = Pick<MilestoneOps, "createEpic" | "listEpics" | "addLabel">;

/**
 * Injected wait for the canonical backoff schedule (tests pass a recorder).
 * Absent ⇒ the SHARED `defaultSleep` imported above, not a local copy of it.
 */
export interface MintMilestoneEpicOptions {
  sleep?: (ms: number) => Promise<void>;
  /**
   * STE-586 — JOIN mode: bind to an existing Epic, never create one. A find
   * leg with no normalized match refuses instead of minting.
   */
  join?: boolean;
  /**
   * STE-608 — the APPROVED decision. When present, the find leg consults
   * `decideMilestoneMint` over the enumerated Epics instead of a bare title
   * match: a join by key binds that key, and closed Epics are never joined.
   */
  expect?: MilestoneMintDecision;
}

/** The pair a mint yields: the tracker's key, and the id derived from it. */
export interface MintedMilestoneEpic {
  /** Verbatim, exactly as the tracker allocated it (`GF-78`). */
  epicKey: string;
  /** `milestoneIdFromEpicKey(epicKey)` (`M_GF_78`). */
  milestoneId: string;
  /**
   * STE-585 — whether the `milestone-<milestoneId>` label was written on the
   * Epic. `false` when the provider has no `addLabel` op or the write rejected.
   */
  readonly labelled: boolean;
  /**
   * STE-608 — whether this call created the Epic or joined an existing one.
   * `created` when this call's create ran (including a retry whose find leg
   * found the create an earlier attempt of THIS call landed); `joined` when
   * the find leg bound an existing Epic before any create.
   */
  readonly outcome: "created" | "joined";
}

/**
 * Mint the milestone Epic for `project` under the human `title`, and return
 * both the tracker-assigned key and the milestone id derived from it.
 *
 * The creation summary is the title ALONE — never the canonical
 * `M_<key> — <Title>` name, which is not knowable until this call returns.
 *
 * A key that will not sanitize to a well-formed `M_<epic-key>` id propagates
 * `milestoneIdFromEpicKey`'s own refusal rather than a locally re-worded guard
 * that could drift from the derivation it protects — so the Epic exists but no
 * malformed id is ever returned.
 */
export async function mintMilestoneEpic(
  provider: MintMilestoneEpicProvider,
  project: string,
  title: string,
  opts?: MintMilestoneEpicOptions,
): Promise<MintedMilestoneEpic> {
  const { createEpic, listEpics } = provider;
  if (!createEpic) {
    throw new Error("mintMilestoneEpic: minting a milestone Epic requires a createEpic op on the provider");
  }
  // STE-586 AC-STE-586.10 — a join is a FIND, and a provider with no
  // enumerator cannot find. Refused here, before `retryTransient`: without
  // this guard the missing find leg would fall straight through to the create
  // a join must never make. Zero lists, zero creates, zero sleeps.
  // STE-608 — an APPROVED join (`expect` act join) is a find too: without
  // this, a provider with no enumerator fell through both find branches to the
  // single create below.
  if ((opts?.join || opts?.expect?.act === "join") && !listEpics) {
    throw new Error(
      [
        `Refusing: to join milestone Epic "${title}" in project ${project} — a join cannot look for the existing Epic because the provider carries no listEpics operation.`,
        "Remedy: give the provider its listEpics op so the join can find the Epic the first repo minted — a join never creates.",
        "Context: mode=jira, phase=milestone-epic-mint, join=true, missing_op=listEpics",
      ].join("\n"),
    );
  }
  // STE-586 AC-STE-586.12 — a title that normalizes to empty names nothing:
  // the find leg would compare against "" and the create would mint an Epic
  // with a blank summary. Refused here, before `retryTransient`. Zero lists,
  // zero creates, zero sleeps.
  const normalized = normalizeMilestoneTitle(title);
  if (normalized === "") {
    throw new Error(
      [
        `Refusing: to mint a milestone Epic in project ${project} whose title is empty once whitespace is normalized.`,
        "Remedy: pass the human title the milestone Epic should carry.",
        "Context: mode=jira, phase=milestone-epic-mint, title=empty",
      ].join("\n"),
    );
  }
  const sleep = opts?.sleep ?? defaultSleep;

  // STE-522 AC-STE-522.10 — steps 1–2 retry as ONE unit on the canonical
  // STE-362 schedule (imported, never re-declared), and the find leg runs
  // INSIDE that unit — the shape this protection had while the create still
  // lived in `attachProjectMilestone`. A create that registers server-side and
  // then times out is therefore FOUND on the retry and reused; a blind
  // re-create would mint the duplicate Epic this contract exists to prevent.
  // The single `createEpic` invocation is a LOOP body, not a second copy, so
  // the op keeps exactly one production call site (AC-STE-522.8). The success
  // path waits zero times — `sleep` fires only after a caught error.
  //
  // STE-586 — two or more Epics whose names normalize equal are AMBIGUOUS.
  // That outcome is PERMANENT (re-listing returns the same page), so it leaves
  // the retry as a value and is raised once, below — never thrown inside,
  // where `retryTransient` would re-list, re-refuse and pay the schedule.
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
    string | { ambiguous: { key: string; name: string }[] } | { joinMiss: true } | { mismatch: string | null }
  >(async () => {
    // STE-608 — this paragraph describes the find leg WITHOUT an approved
    // decision; with one (`expect`), the first branch below decides instead.
    // The find leg matches by NAME: at mint time no key exists to match on.
    // It runs on the FIRST attempt as well as on retries, which makes minting
    // IDEMPOTENT: re-running a mint — after a crash, a resumed session, an
    // operator repeating a step — reuses the Epic instead of creating a
    // second one. Moving this inside the retry's failure path would restore
    // duplicate minting on exactly the re-run an operator is most likely to
    // make; that is pinned in this FR's suite and mutation-verified.
    // `listEpics` is optional; without it a mint simply has no find leg.
    // STE-586 — the name match is NORMALIZED on both sides
    // (`matchMilestoneTitle`), so a stray space or case difference joins the
    // existing Epic instead of minting a twin. The create below still receives
    // the RAW title.
    if (listEpics && expected) {
      // STE-608 AC-STE-608.1 + .8 — with an approved decision the find leg is
      // the ONE decision (`decideMilestoneMint`, via `reconcileApprovedMint`),
      // never a local re-derivation: a join by key binds that key whatever
      // its title, a Done Epic is never joined, and any act other than the
      // approved one leaves the retry as a mismatch, refused once below.
      const rows = (await listEpics(project)) as JiraDecisionRow[];
      const found = reconcileApprovedMint({ mode: "jira", project, rows }, title, expected, createAttempted);
      if (found !== null) return found;
    } else if (listEpics) {
      const matches = matchMilestoneTitle(await listEpics(project), title);
      if (matches.length > 1) return { ambiguous: matches };
      if (matches.length === 1) return matches[0]!.key;
      if (opts?.join) return { joinMiss: true };
    }
    // Step 1 — the summary is the title, the only value that exists yet.
    // Step 2 — read the key back, verbatim.
    createAttempted = true;
    return (await createEpic(project, { name: title })).key;
  }, sleep);

  if (typeof outcome !== "string" && "mismatch" in outcome) {
    throw approvedMintMismatchRefusal({
      mode: "jira",
      phase: "milestone-epic-mint",
      container: "milestone Epic",
      noun: "Epic",
      title,
      project,
      // A mismatch is only ever returned by the approved-decision find leg.
      expected: expected!,
      found: outcome.mismatch,
    });
  }
  if (typeof outcome !== "string" && "joinMiss" in outcome) {
    throw new Error(
      [
        `Refusing: to join milestone Epic "${title}" in project ${project} — no existing Epic matches it (normalized "${normalized}").`,
        "Remedy: check the title against the milestone the first repo minted, or mint it from that repo — a join never creates.",
        `Context: mode=jira, phase=milestone-epic-mint, join=true, normalized=${normalized}`,
      ].join("\n"),
    );
  }
  if (typeof outcome !== "string" && "ambiguous" in outcome) {
    const candidates = outcome.ambiguous.map((epic) => `${epic.key} "${epic.name}"`).join(", ");
    throw new Error(
      [
        `Refusing: to mint milestone Epic "${title}" in project ${project} — ${outcome.ambiguous.length} existing Epics normalize to the same title: ${candidates}.`,
        "Remedy: rename one of them in the tracker so their titles no longer normalize equal, then re-run the mint; to bind a specific one, join by its Epic key instead of by title.",
        `Context: mode=jira, phase=milestone-epic-mint, normalized=${normalized}`,
      ].join("\n"),
    );
  }
  const epicKey = outcome;
  // A key returned by the create itself, or found only after a create was
  // attempted, is a create; a key found before any create is a join.
  const performed: "created" | "joined" = createAttempted ? "created" : "joined";

  // Step 3 — derive the id from the key; refusals propagate. Deliberately
  // OUTSIDE the retry: a key that will not sanitize is permanent, and paying
  // the backoff schedule for it would re-create the Epic three more times.
  const milestoneId = milestoneIdFromEpicKey(epicKey);

  // STE-585 — write the milestone label on the Epic, once. It runs AFTER the
  // derivation (a refused key never gets a label) and OUTSIDE the retry (a
  // label write is not worth re-paying the backoff schedule). The label value
  // is DERIVED from `milestoneId` through `milestoneLabel`, the one function
  // that decides the label string for every writer and reader — never composed
  // here from the raw key or by hand. A rejection is swallowed: the Epic and
  // the id stand, only `labelled` reports the miss.
  let labelled = false;
  if (provider.addLabel) {
    try {
      await provider.addLabel(epicKey, milestoneLabel(milestoneId));
      labelled = true;
    } catch {
      labelled = false;
    }
  }

  return { epicKey, milestoneId, labelled, outcome: performed };
}

// ---------------------------------------------------------------------------
// Command-line entry point
// ---------------------------------------------------------------------------
//
// The create itself is an MCP call only the session can make, so the front
// door takes the key that call ALLOCATED and puts it through the very same
// `mintMilestoneEpic` contract the route uses: the summary that had to be sent
// is echoed back (the title alone, read off the recorded creation argument —
// not re-composed here), the key is read back verbatim, and the id is derived.
// An unsanitizable key refuses at this door exactly as it refuses in the route,
// so a malformed `M_` id can never reach a plan filename.
//
//   bun run adapters/_shared/src/mint_milestone_epic.ts GF "Waiting States II" GF-78
//   summary=Waiting States II
//   epicKey=GF-78
//   milestoneId=M_GF_78
//   plan=specs/plan/M_GF_78.md
//   label=milestone-M_GF_78
//   outcome=created
//   labels=["milestone-M_GF_78"]
//
// The label, like the summary, is read off the argument the helper actually
// sent to its recording `addLabel` — the door creates and writes nothing.
//
// `import.meta.main` is false on import, so the module stays side-effect free
// for the route that consumes it.
if (import.meta.main) {
  const project = process.argv[2];
  const title = process.argv[3];
  const allocatedKey = process.argv[4];

  if (project === undefined || title === undefined || allocatedKey === undefined) {
    console.error(
      [
        "Refusing: to mint a milestone Epic without a project, a human title and the key the tracker allocated.",
        "Remedy: bun run adapters/_shared/src/mint_milestone_epic.ts <project> <title> <allocated-epic-key>",
        "Context: mode=jira, phase=milestone-epic-mint, argv=incomplete",
      ].join("\n"),
    );
    process.exitCode = 1;
  } else {
    // The summary is READ OFF the creation argument the helper actually sent,
    // never re-derived from `title` here — a front door that printed its own
    // input would report the rule rather than measure it.
    let sentSummary: string | null = null;
    let sentLabel: string | null = null;
    try {
      const minted = await mintMilestoneEpic(
        {
          createEpic: async (_project: string, opts: { name: string }) => {
            sentSummary = opts.name;
            return { key: allocatedKey };
          },
          addLabel: async (_ticketId: string, label: string) => {
            sentLabel = label;
          },
        },
        project,
        title,
      );
      console.log(printable(`summary=${sentSummary ?? ""}`));
      console.log(`epicKey=${minted.epicKey}`);
      console.log(`milestoneId=${minted.milestoneId}`);
      console.log(`plan=specs/plan/${minted.milestoneId}.md`);
      console.log(printable(`label=${sentLabel ?? ""}`));
      console.log(`outcome=${minted.outcome}`);
      // STE-608 AC-STE-608.9 — a create's label value, computed from an empty set.
      console.log(printable(`labels=${JSON.stringify(mergeMilestoneLabel([], minted.milestoneId))}`));
    } catch (error) {
      // One printable line per refusal line: echoed titles cannot start a new one.
      const message = error instanceof Error ? error.message : String(error);
      console.error(message.split("\n").map(printable).join("\n"));
      process.exitCode = 1;
    }
  }
}

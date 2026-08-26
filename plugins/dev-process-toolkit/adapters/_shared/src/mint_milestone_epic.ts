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
import { defaultSleep, retryTransient } from "./attach_project_milestone";
import { milestoneIdFromEpicKey } from "./milestone_token";

/**
 * The ops a mint uses: the Epic creator declared on `MilestoneOps`, plus the
 * OPTIONAL enumeration op the retry's find leg needs. Both are optional on
 * `MilestoneOps` itself, so a provider that carries only `createEpic` still
 * satisfies this type — it just mints without a find leg.
 */
export type MintMilestoneEpicProvider = Pick<MilestoneOps, "createEpic" | "listEpics">;

/**
 * Injected wait for the canonical backoff schedule (tests pass a recorder).
 * Absent ⇒ the SHARED `defaultSleep` imported above, not a local copy of it.
 */
export interface MintMilestoneEpicOptions {
  sleep?: (ms: number) => Promise<void>;
}

/** The pair a mint yields: the tracker's key, and the id derived from it. */
export interface MintedMilestoneEpic {
  /** Verbatim, exactly as the tracker allocated it (`GF-78`). */
  epicKey: string;
  /** `milestoneIdFromEpicKey(epicKey)` (`M_GF_78`). */
  milestoneId: string;
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
  const epicKey = await retryTransient<string>(async () => {
    // The find leg matches by NAME: at mint time no key exists to match on.
    // It runs on the FIRST attempt as well as on retries, which makes minting
    // IDEMPOTENT: re-running a mint — after a crash, a resumed session, an
    // operator repeating a step — reuses the Epic instead of creating a
    // second one. Moving this inside the retry's failure path would restore
    // duplicate minting on exactly the re-run an operator is most likely to
    // make; that is pinned in this FR's suite and mutation-verified.
    // `listEpics` is optional; without it a mint simply has no find leg.
    if (listEpics) {
      const found = (await listEpics(project)).find((epic) => epic.name === title);
      if (found) return found.key;
    }
    // Step 1 — the summary is the title, the only value that exists yet.
    // Step 2 — read the key back, verbatim.
    return (await createEpic(project, { name: title })).key;
  }, sleep);

  // Step 3 — derive the id from the key; refusals propagate. Deliberately
  // OUTSIDE the retry: a key that will not sanitize is permanent, and paying
  // the backoff schedule for it would re-create the Epic three more times.
  const milestoneId = milestoneIdFromEpicKey(epicKey);

  return { epicKey, milestoneId };
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
    try {
      const minted = await mintMilestoneEpic(
        {
          createEpic: async (_project: string, opts: { name: string }) => {
            sentSummary = opts.name;
            return { key: allocatedKey };
          },
        },
        project,
        title,
      );
      console.log(`summary=${sentSummary ?? ""}`);
      console.log(`epicKey=${minted.epicKey}`);
      console.log(`milestoneId=${minted.milestoneId}`);
      console.log(`plan=specs/plan/${minted.milestoneId}.md`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}

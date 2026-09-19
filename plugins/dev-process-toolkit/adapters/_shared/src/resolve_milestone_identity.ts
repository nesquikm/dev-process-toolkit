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
//
// STE-608 — the per-mode `switch` above is the path WITHOUT an enumerated
// listing. When the caller hands the tracker modes the container listing it
// enumerated (`rows`) or a `joinKey`, neither `resolveMilestoneIdentity` nor
// `milestoneAllocationGateSpec` creates anything: both consult the ONE
// decision (`decideMilestoneMint`), a join derives its id from the listed key,
// and a create is left to the approved mint (`expect` = the gate's decision).
// The module's CLI is the decision front door (bottom of this file): it
// decides from a saved raw listing and writes one `milestone-decision`
// receipt, which the pre-tracker-write gate reads before any container create.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { adoptOrMintMilestoneId, type MilestoneMinter } from "./adopt_or_mint_milestone_id";
import { checkVersionFloor, nfr10Message, runningDptVersion } from "./dpt_version";
import { mergeMilestoneLabel } from "./attach_project_milestone";
import { announceReceipt, oneLine, printable, writeReceipt } from "./tracker_receipts";
import { readWorkspaceBinding } from "./workspace_binding";
import { verifySpan } from "./spans_repos";
import {
  decideMilestoneMint,
  type JiraDecisionRow,
  type LinearDecisionRow,
  type MilestoneMintDecision,
  milestoneIdFromEpicKey,
  milestoneIdFromLinearMilestone,
} from "./milestone_token";
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
  /**
   * STE-608 — the container listing the session enumerated (Jira Epics or
   * Linear milestones). When present on a tracker mode, the gate spec decides
   * create-or-join through `decideMilestoneMint` before anything is written.
   */
  rows?: readonly JiraDecisionRow[] | readonly LinearDecisionRow[];
  /** STE-608 — the existing container's key, in place of `title`, to join by key. */
  joinKey?: string;
  /** STE-608 — whether the repository's tracker binding is shared. */
  shared?: boolean;
}

/** A resolved milestone identity. `id` is present on the `none` branch only. */
export interface MilestoneIdentity {
  /** The milestone token that names the plan file: `M102` / `M_PROJ_500` / `M_0K0K0K`. */
  milestoneId: string;
  /** The full minted `fr_`-prefixed id, written to plan frontmatter. `mode: none` only. */
  id?: string;
  /** STE-608 — `"joined"` when the identity came from joining a listed container by key. */
  outcome?: "joined";
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
  /**
   * The `defaultValue` slot: the resolved milestone token, and nothing else.
   * STE-608 AC-STE-608.6 — `undefined` exactly when the default is forbidden
   * (a title join in a shared container), so the auto-approve marker cannot
   * apply it and `requireOrRefuse` refuses instead.
   */
  defaultValue: string | undefined;
  /** The full identity, so the `mode: none` `id` reaches plan frontmatter. */
  identity: MilestoneIdentity;
  /**
   * STE-608 — the decision the gate approves, handed to the mint as its
   * `expect`. Present exactly when the input carried the enumerated `rows`.
   */
  decision?: MilestoneMintDecision;
}

/** STE-608 — a listed row as the gate sentence reads it (Jira rows may carry a status name). */
type GateSentenceRow = { readonly key?: string; readonly id?: string; readonly statusName?: string; readonly statusCategory?: string };

/** STE-608 — the rows a tracker-mode decision reads, with exactly one of a title or a join key. */
function decideFromListing(
  mode: "jira" | "linear",
  project: string,
  rows: readonly JiraDecisionRow[] | readonly LinearDecisionRow[],
  pick: { joinKey: string } | { title: string | undefined },
): MilestoneMintDecision {
  return mode === "jira"
    ? decideMilestoneMint({ mode, project, rows: rows as readonly JiraDecisionRow[], ...pick })
    : decideMilestoneMint({ mode, project, rows: rows as readonly LinearDecisionRow[], ...pick });
}

/** STE-608 — the milestone id a joined container's listed key derives. */
function joinedMilestoneId(mode: "jira" | "linear", key: string): string {
  return mode === "jira" ? milestoneIdFromEpicKey(key) : milestoneIdFromLinearMilestone(key);
}

/**
 * STE-608 AC-STE-608.6 — the ONE home of the gate sentence and the default
 * rule, read by both the decision front door and `milestoneAllocationGateSpec`.
 * A create names the container kind, the title and the project; a join names
 * the key, the container's current title and status, and that nothing is
 * created. The default is forbidden exactly on a title join in a shared
 * container.
 */
export function milestoneGateSentence(input: {
  mode: "jira" | "linear";
  project: string;
  title?: string;
  decision: MilestoneMintDecision;
  rows: readonly GateSentenceRow[];
  shared: boolean;
  /** STE-610 AC-STE-610.4 — the sibling a shared join was verified against (dry run). */
  sibling?: { tag: string; path: string };
}): { gate: string; forbidden: boolean } {
  const { mode, project, decision } = input;
  const kind = mode === "jira" ? "Epic" : "project milestone";
  let gate: string;
  if (decision.act === "join") {
    const row = mode === "jira" ? input.rows.find((r) => r.key === decision.key) : undefined;
    const status = mode === "jira" ? `status ${row?.statusName ?? row?.statusCategory ?? "unknown"}` : "no status listed";
    const withSibling = input.sibling === undefined ? "" : ` with sibling ${input.sibling.tag} at ${input.sibling.path}`;
    gate = `join the existing ${kind} ${decision.key} "${decision.name}" (${status}) in project ${project} via ${decision.via}${withSibling}; nothing is created.`;
  } else {
    gate = `create a new ${kind} "${input.title ?? ""}" in project ${project}.`;
  }
  const forbidden = decision.act === "join" && decision.via === "title" && input.shared;
  return { gate, forbidden };
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
  // STE-608 AC-STE-608.2 — a join KEY on a tracker mode joins the listed row
  // it names and never compares a title. `decideMilestoneMint` refuses a key
  // naming no listed row (an absent listing lists nothing), so a join key can
  // never fall through to the create below.
  //
  // STE-608 AC-STE-608.7 — with an enumerated listing, resolving is a READ:
  // the listing decides, a join derives its id from the listed key, and a
  // create is refused here — it runs only through the approved mint (with the
  // gate's decision as its `expect`), never inside identity resolution.
  if ((input.joinKey !== undefined || input.rows !== undefined) && (input.mode === "jira" || input.mode === "linear")) {
    const project = input.project ?? "";
    const pick = input.joinKey !== undefined ? { joinKey: input.joinKey } : { title: input.title };
    const decision = decideFromListing(input.mode, project, input.rows ?? [], pick);
    if (decision.act !== "join") {
      throw new Error(
        [
          input.joinKey !== undefined
            ? `Refusing: join key ${JSON.stringify(input.joinKey)} in project ${JSON.stringify(project)} did not decide a join, and resolving never creates.`
            : `Refusing: the listing for project ${JSON.stringify(project)} decided a create of ${JSON.stringify(input.title ?? "")}, and resolving never creates.`,
          "Remedy: ask the milestone-allocation gate with milestoneAllocationGateSpec's decision, then pass that approved decision to the mint as its expect.",
          `Context: mode=${input.mode}, phase=resolve-milestone-identity, act=${decision.act}`,
        ].join("\n"),
      );
    }
    return { milestoneId: joinedMilestoneId(input.mode, decision.key), outcome: "joined" };
  }
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
 * `gateSite` is mode-independent, so the modes are indistinguishable at the
 * gate except for the value they recommend. The caller passes `defaultValue`
 * into `requireOrRefuse`'s `defaultValue` slot (marker present ⇒ default-apply
 * and emit `milestone_allocation_default_applied`; marker absent + non-tty ⇒
 * `RequiresInputRefusedError`) and writes `identity.id`, when present, into the
 * plan's frontmatter.
 *
 * Two shapes, and only the second mints before the gate:
 *
 *   - WITH an enumerated listing (`rows`, tracker modes — STE-608): the gate
 *     approves the ONE decision and NOTHING is created here. A join's
 *     `defaultValue` is the id its listed key derives (`undefined` when the
 *     default is forbidden — a title join in a shared container); a create's
 *     is the act `"create"`, with an empty `identity.milestoneId`, because the
 *     id does not exist until the approved mint runs with `decision` as its
 *     `expect`.
 *   - WITHOUT a listing: the dispatcher sits INSIDE the `defaultValue`
 *     computation — `resolveMilestoneIdentity`, whose `linear` branch mints
 *     the tracker milestone — and `defaultValue` is the resolved token.
 */
export async function milestoneAllocationGateSpec(
  input: ResolveMilestoneIdentityInput,
): Promise<MilestoneAllocationGateSpec> {
  // STE-608 AC-STE-608.1 — with an enumerated listing, the gate approves the
  // ONE decision. Nothing is created here: a join derives its id from the
  // listed key, and a create's id does not exist until the approved mint runs.
  if (input.rows !== undefined && (input.mode === "jira" || input.mode === "linear")) {
    const project = input.project ?? "";
    const pick = input.joinKey !== undefined ? { joinKey: input.joinKey } : { title: input.title };
    const decision = decideFromListing(input.mode, project, input.rows, pick);
    const { forbidden } = milestoneGateSentence({
      mode: input.mode,
      project,
      title: input.title,
      decision,
      rows: input.rows as readonly GateSentenceRow[],
      shared: input.shared === true,
    });
    if (decision.act === "join") {
      const milestoneId = joinedMilestoneId(input.mode, decision.key);
      return {
        gateSite: MILESTONE_ALLOCATION_GATE_SITE,
        defaultValue: forbidden ? undefined : milestoneId,
        identity: { milestoneId },
        decision,
      };
    }
    // A create has no milestone id before the approved mint allocates one;
    // the default the gate recommends is the act itself.
    return { gateSite: MILESTONE_ALLOCATION_GATE_SITE, defaultValue: "create", identity: { milestoneId: "" }, decision };
  }
  const identity = await resolveMilestoneIdentity(input);
  return {
    gateSite: MILESTONE_ALLOCATION_GATE_SITE,
    defaultValue: identity.milestoneId,
    identity,
  };
}

// ------------------------------------------------------- the decision front door
//
// STE-608 AC-STE-608.5 —
//   bun run adapters/_shared/src/resolve_milestone_identity.ts \
//     <projectRoot> <mode> <project> <listingFile> --title <title> | --join-key <key> [--sibling <path>]
//
// STE-610 AC-STE-610.4 — in a repository whose binding is shared, a join is
// decided only with `--sibling <path>`: the span checks run as a dry run
// (`verifySpan`, nothing written), and the sibling's tag and path join the
// gate sentence and the receipt. An unshared repository refuses `--sibling`
// and decides exactly as STE-608 did without it.
//
// Decides create-or-join from the RAW listing the session saved (a Jira
// `searchJiraIssuesUsingJql` page, or a Linear `list_milestones` answer),
// prints the decision one field per line, and writes exactly one
// `milestone-decision` receipt under <projectRoot>. Everything is decided
// first and written last: every refusal exits 1 with an NFR-10 message on
// stderr, nothing on stdout and nothing on disk.

/** A refusal the front door exits 1 on; its message is NFR-10 three-line. */
class FrontDoorRefusal extends Error {
  constructor(verdict: string, remedy: string, context: string) {
    // Each part is flattened BEFORE the lines are joined: a listing's keys and
    // issue types are tracker-controlled text, and a newline in one must never
    // start a line of its own (a forged `Remedy:` — or a `dpt-receipt:`).
    super(nfr10Message(oneLine(verdict), oneLine(remedy), oneLine(context)));
    this.name = "FrontDoorRefusal";
  }
}

const FRONT_DOOR_USAGE =
  "resolve_milestone_identity.ts <projectRoot> <jira|linear> <project> <listingFile> --title <title> | --join-key <key> [--sibling <path>]";

interface FrontDoorArgs {
  projectRoot: string;
  mode: "jira" | "linear";
  project: string;
  listingFile: string;
  title?: string;
  joinKey?: string;
  sibling?: string;
}

function parseFrontDoorArgs(argv: readonly string[]): FrontDoorArgs {
  const context = `argc=${argv.length}, usage=${FRONT_DOOR_USAGE}`;
  const hasSibling = argv.length === 8;
  if (argv.length !== 6 && !(hasSibling && argv[6] === "--sibling")) {
    throw new FrontDoorRefusal(
      `Refusing: incomplete or extra arguments — the decision needs a project root, a mode, a project, a listing file and exactly one of --title or --join-key.`,
      `run ${FRONT_DOOR_USAGE}`,
      context,
    );
  }
  const [projectRoot, mode, project, listingFile, flag, value] = argv as [string, string, string, string, string, string];
  if (mode !== "jira" && mode !== "linear") {
    throw new FrontDoorRefusal(
      `Refusing: unknown mode "${mode}" — only jira and linear list milestone containers to decide against.`,
      `pass mode jira or linear.`,
      `mode=${mode}, ${context}`,
    );
  }
  const sibling = hasSibling ? argv[7]! : undefined;
  if ((flag !== "--title" && flag !== "--join-key") || value === "" || projectRoot === "" || project === "" || listingFile === "" || sibling === "") {
    throw new FrontDoorRefusal(
      `Refusing: incomplete arguments — expected a non-empty --title or --join-key after the listing file (got ${flag}).`,
      `run ${FRONT_DOOR_USAGE}`,
      context,
    );
  }
  return {
    projectRoot: resolve(projectRoot),
    mode,
    project,
    listingFile,
    ...(flag === "--title" ? { title: value } : { joinKey: value }),
    ...(sibling !== undefined ? { sibling } : {}),
  };
}

interface ReadListing {
  sha256: string;
  rowKeys: string[];
  jiraRows?: (JiraDecisionRow & { statusName?: string })[];
  linearRows?: LinearDecisionRow[];
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function readListingFile(args: FrontDoorArgs): ReadListing {
  const context = `mode=${args.mode}, project=${args.project}, listing=${args.listingFile}`;
  let bytes: Buffer;
  try {
    bytes = readFileSync(args.listingFile);
  } catch (e) {
    throw new FrontDoorRefusal(
      `Refusing: the listing file ${args.listingFile} cannot be read (${(e as NodeJS.ErrnoException).code ?? (e as Error).message}).`,
      `save the tracker's listing answer to a readable file and pass its path.`,
      context,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf-8"));
  } catch (e) {
    throw new FrontDoorRefusal(
      `Refusing: the listing file ${args.listingFile} is not JSON (${(e as Error).message}).`,
      `save the tracker's raw JSON answer, unedited, and pass its path.`,
      context,
    );
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const shape = (what: string): FrontDoorRefusal =>
    new FrontDoorRefusal(
      `Refusing: the listing file ${args.listingFile} is not a recognised ${args.mode} listing — ${what}.`,
      args.mode === "jira"
        ? `save the raw searchJiraIssuesUsingJql answer ({ issues: [...] }) for project ${args.project}'s Epics.`
        : `save the raw list_milestones answer ({ milestones: [...] }) for project ${args.project}.`,
      context,
    );

  if (args.mode === "linear") {
    if (!isObject(parsed) || !Array.isArray(parsed.milestones)) throw shape("it has no `milestones` array");
    const rows: LinearDecisionRow[] = [];
    for (const m of parsed.milestones as unknown[]) {
      if (!isObject(m) || typeof m.id !== "string" || m.id === "" || typeof m.name !== "string") {
        throw shape("a milestone row carries no string `id` and `name`");
      }
      rows.push({ id: m.id, name: m.name });
    }
    return { sha256, rowKeys: rows.map((r) => r.id!), linearRows: rows };
  }

  if (!isObject(parsed) || !Array.isArray(parsed.issues)) throw shape("it has no `issues` array");
  const token = parsed.nextPageToken;
  // A page that does not SAY it is the last one has not proven the container
  // absent: `isLast` must be the boolean `true`, as `create_idempotency_probe`
  // requires of the same Jira search answer.
  if (parsed.isLast !== true || (token !== undefined && token !== null && token !== "")) {
    throw new FrontDoorRefusal(
      `Refusing: the listing file ${args.listingFile} is not the last page of the Epic search (isLast=${String(parsed.isLast)}, nextPageToken=${token === undefined || token === null ? "absent" : "present"}) — a later page may hold the container this decision would miss.`,
      `page the search to the end and save one listing holding every Epic, then decide again.`,
      context,
    );
  }
  const rows: (JiraDecisionRow & { statusName?: string })[] = [];
  for (const issue of parsed.issues as unknown[]) {
    if (!isObject(issue) || typeof issue.key !== "string" || issue.key === "" || !isObject(issue.fields)) {
      throw shape("an issue row carries no `key` and `fields`");
    }
    const key = issue.key;
    const f = issue.fields;
    if (typeof f.summary !== "string") throw shape(`issue ${key} carries no string \`summary\``);
    const projectKey = isObject(f.project) && typeof f.project.key === "string" ? f.project.key : undefined;
    if (projectKey !== args.project || !key.startsWith(`${args.project}-`)) {
      throw new FrontDoorRefusal(
        `Refusing: issue ${key} is keyed outside project ${args.project} (project ${projectKey ?? "absent"}) — the file is not that project's Epic listing.`,
        `enumerate project ${args.project}'s Epics only, save that answer, and decide again.`,
        `${context}, row=${key}`,
      );
    }
    const typeName = isObject(f.issuetype) && typeof f.issuetype.name === "string" ? f.issuetype.name : undefined;
    if (typeName !== "Epic") {
      throw new FrontDoorRefusal(
        `Refusing: issue ${key} is ${typeName === undefined ? "listed with no issue type" : `a ${typeName}, not an Epic`} — the file is not project ${args.project}'s Epic listing.`,
        `enumerate project ${args.project}'s Epics with the issuetype field, save that answer, and decide again.`,
        `${context}, row=${key}, issuetype=${typeName ?? "absent"}`,
      );
    }
    const status = isObject(f.status) ? f.status : undefined;
    const category = status && isObject(status.statusCategory) && typeof status.statusCategory.key === "string"
      ? status.statusCategory.key
      : undefined;
    const labels = Array.isArray(f.labels) ? (f.labels as unknown[]).filter((l): l is string => typeof l === "string") : undefined;
    rows.push({
      key,
      name: f.summary,
      ...(category !== undefined ? { statusCategory: category } : {}),
      ...(status && typeof status.name === "string" ? { statusName: status.name } : {}),
      ...(labels !== undefined ? { labels } : {}),
    });
  }
  return { sha256, rowKeys: rows.map((r) => r.key), jiraRows: rows };
}

/**
 * STE-610 AC-STE-610.4 — the sibling a shared join names, verified by the span
 * checks as a dry run: nothing is written into either plan, and this side's
 * plan does not exist yet, so none is graded. The milestone is the joined
 * key's id — the token both plans are named after.
 */
async function verifyJoinSibling(
  args: FrontDoorArgs,
  milestoneId: string,
): Promise<{ tag: string; path: string }> {
  // A refusal is the span reader's own NFR-10 text; the front door's catch
  // prints it verbatim, line by line through `printable`.
  const v = await verifySpan({
    invokingRepo: args.projectRoot,
    planFile: null,
    milestone: milestoneId,
    siblingPath: args.sibling!,
    dryRun: true,
  });
  return { tag: v.siblingTag, path: v.siblingRoot };
}

/** Decide, then write the one receipt, then return the lines to print. */
async function runDecisionFrontDoor(argv: readonly string[]): Promise<string[]> {
  const args = parseFrontDoorArgs(argv);
  const listing = readListingFile(args);

  // The shared flag and the floor: each reader's own refusal propagates, so an
  // unreadable or refused declaration is never read as unshared.
  const binding = readWorkspaceBinding(join(args.projectRoot, "CLAUDE.md"), args.mode);
  const floor = checkVersionFloor(binding, runningDptVersion());
  if (!floor.ok) throw new Error(floor.message);

  const pick = args.joinKey !== undefined ? { joinKey: args.joinKey } : { title: args.title };
  const decision = decideFromListing(
    args.mode,
    args.project,
    args.mode === "jira" ? listing.jiraRows! : listing.linearRows!,
    pick,
  );

  const rowCount = listing.rowKeys.length;
  const listingLine =
    args.mode === "jira"
      ? `${rowCount} rows, ${listing.jiraRows!.filter((r) => r.statusCategory === "done").length} closed excluded`
      : `${rowCount} rows, closed rule not applicable (Linear milestones carry no status)`;

  const milestoneId = decision.act === "join" ? joinedMilestoneId(args.mode, decision.key) : "";

  // STE-610 AC-STE-610.4 — `--sibling` names a shared join's sibling, and
  // nothing else: an unshared repository and a create both refuse it.
  const ctx = `mode=${args.mode}, project=${args.project}, act=${decision.act}, shared=${binding.shared}`;
  if (args.sibling !== undefined && !binding.shared) {
    throw new FrontDoorRefusal(
      `Refusing: --sibling names the sibling of a join in a shared repository, and ${args.projectRoot} declares no repo_tag — its binding is not shared.`,
      `drop --sibling and decide again; an unshared repository joins without one.`,
      ctx,
    );
  }
  if (args.sibling !== undefined && decision.act !== "join") {
    throw new FrontDoorRefusal(
      `Refusing: --sibling names the sibling of a join, and the listing decided a create of "${args.title ?? ""}" — there is no joined milestone for the sibling to plan.`,
      `drop --sibling to create, or pass --join-key <key> naming the container the sibling planned.`,
      ctx,
    );
  }
  if (decision.act === "join" && binding.shared && args.sibling === undefined) {
    throw new FrontDoorRefusal(
      `Refusing: the listing decided a join of ${decision.key} (${milestoneId}) in a shared repository, and no --sibling names the repository that planned it.`,
      `pass --sibling <path> naming the sibling repository whose plan holds ${milestoneId}, or pass a distinct --title to create a new container instead.`,
      `${ctx}, key=${decision.key}`,
    );
  }
  const sibling = args.sibling !== undefined ? await verifyJoinSibling(args, milestoneId) : undefined;

  const { gate, forbidden } = milestoneGateSentence({
    mode: args.mode,
    project: args.project,
    title: args.title,
    decision,
    rows: listing.jiraRows ?? [],
    shared: binding.shared,
    ...(sibling !== undefined ? { sibling } : {}),
  });

  const act = decision.act;
  const via = decision.act === "join" ? decision.via : "";
  const key = decision.act === "join" ? decision.key : "";
  const lines = [
    `act=${act}`,
    `via=${via}`,
    `key=${key}`,
    `milestoneId=${milestoneId}`,
    `listing=${listingLine}`,
    `gate=${gate}`,
    `default=${forbidden ? "forbidden" : "allowed"}`,
  ];
  // STE-608 AC-STE-608.9 — a Jira join prints the computed label value: the
  // Epic's labels as listed plus the milestone label, or `unchanged`.
  const observedLabels = decision.act === "join" && args.mode === "jira" ? decision.labels : undefined;
  if (observedLabels !== undefined) {
    const merged = mergeMilestoneLabel(observedLabels, milestoneId);
    lines.push(`labels=${merged === null ? "unchanged" : JSON.stringify(merged)}`);
  }
  const printed = lines.map(printable);

  // Decided — write last.
  const path = writeReceipt(args.projectRoot, {
    kind: "milestone-decision",
    adapter: args.mode,
    container: args.project,
    subject: args.joinKey ?? args.title ?? "",
    decision: act,
    evidence: {
      act,
      via,
      key,
      milestoneId,
      ...(args.joinKey !== undefined ? { joinKey: args.joinKey } : { title: args.title }),
      ...(decision.act === "create" && decision.excluded ? { excluded: decision.excluded } : {}),
      ...(observedLabels !== undefined ? { labels: observedLabels } : {}),
      shared: binding.shared,
      ...(sibling !== undefined ? { sibling: { tag: sibling.tag, path: sibling.path, given: args.sibling } } : {}),
      default: forbidden ? "forbidden" : "allowed",
      listing: { file: resolve(args.listingFile), sha256: listing.sha256, rowKeys: listing.rowKeys },
    },
  });
  return [...printed, announceReceipt(path)];
}

if (import.meta.main) {
  try {
    const lines = await runDecisionFrontDoor(process.argv.slice(2));
    process.stdout.write(`${lines.join("\n")}\n`);
    process.exit(0);
  } catch (e) {
    const message = (e as Error).message ?? String(e);
    const text = /^Remedy:/m.test(message) && /^Context:/m.test(message)
      ? message
      : nfr10Message(
          `Refusing: ${message}`,
          `fix the input named above and run the decision again.`,
          `helper=resolve_milestone_identity, phase=milestone-decision-front-door`,
        );
    process.stderr.write(`${text.split("\n").map(printable).join("\n")}\n`);
    process.exit(1);
  }
}

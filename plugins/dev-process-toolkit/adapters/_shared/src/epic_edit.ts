// epic_edit — STE-729.
//
// The one checked path for editing a milestone's Jira Epic text from the
// repository that planned it:
//
//   bun run epic_edit.ts <projectRoot> <EPIC-KEY>
//
// Listed in `RECEIPT_WRITING_SUBCOMMANDS` (pre-tracker-write-gate) with no
// subcommand, so its whole CLI is one receipt-writing front door and the hook
// accepts exactly the argv above.
//
// Five checks run in order, and the first that fails refuses: (a) the git
// index tracks the milestone's plan, live or archived; (b) that indexed plan
// carries `milestone: <M>`; (c) its index and working-tree frontmatter agree;
// (d) the binding is Jira mode; (e) the indexed plan carries
// `container_origin: minted` — this repository minted the Epic.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { adapterOf } from "./container_ownership";
import { indexBlob, tracked } from "./epic_close";
import { parseFrontmatter } from "./frontmatter";
import { milestoneIdFromEpicKey } from "./milestone_token";
import { announceReceipt, oneLine, writeReceipt, type ReceiptInput } from "./tracker_receipts";

/** The one `epic-edit` receipt the module writes once every check holds, naming the key. */
export function epicEditReceipt(epicKey: string, evidence: unknown): ReceiptInput {
  return { kind: "epic-edit", adapter: "jira", container: null, subject: epicKey, decision: "edit", evidence };
}

/** The accepted argv after the module path. */
export interface EpicEditArgs {
  projectRoot: string;
  epicKey: string;
}

/** Parses `<projectRoot> <EPIC-KEY>`; anything else throws. */
export function parseEpicEditArgs(argv: readonly string[]): EpicEditArgs {
  if (argv.length !== 2) throw new Error("usage: epic_edit.ts <projectRoot> <EPIC-KEY>");
  return { projectRoot: argv[0]!, epicKey: argv[1]! };
}

/** A refusal in the NFR-10 shape: verdict, `Remedy:`, `Context:` — one line each. */
export class EpicEditRefusal extends Error {
  constructor(verdict: string, remedy: string, context: string) {
    super([`epic_edit: ${oneLine(verdict)}`, `Remedy: ${oneLine(remedy)}`, `Context: ${oneLine(context)}, module=epic_edit.ts`].join("\n"));
  }
}

export const USAGE = "bun run epic_edit.ts <projectRoot> <EPIC-KEY>";

/** A canonical Jira issue key: upper-case project, a hyphen, digits. */
const CANONICAL_EPIC_KEY = /^[A-Z][A-Z0-9]*-\d+$/;

/**
 * Run the five checks (a)-(e) (AC-STE-729.2, AC-STE-729.12); write one
 * `epic-edit` receipt when every one holds, otherwise throw an `EpicEditRefusal`. Returns the stdout lines:
 * `default=forbidden`, the Edit/Skip options and the receipt announcement.
 */
export function editEpic(args: EpicEditArgs): string {
  const projectRoot = resolve(args.projectRoot);
  const { epicKey } = args;
  // The key must be a canonical Jira key before any plan lookup: a key the
  // sanitizer would rewrite (proj-500, PROJ.500, ...) names no Epic exactly.
  if (!CANONICAL_EPIC_KEY.test(epicKey)) {
    throw new EpicEditRefusal(
      `the Epic key ${JSON.stringify(epicKey)} is not a canonical Jira key (<PROJECT>-<number>, upper-case project)`,
      `run ${USAGE} with the exact Jira key of the Epic this repository planned, e.g. PROJ-500`,
      `epic=${JSON.stringify(epicKey)}, root=${projectRoot}`,
    );
  }
  let milestone: string;
  try {
    milestone = milestoneIdFromEpicKey(epicKey);
  } catch (e) {
    throw new EpicEditRefusal(
      `the Epic key ${JSON.stringify(epicKey)} does not name a milestone: ${e instanceof Error ? e.message : String(e)}`,
      `run ${USAGE} with the Jira key of the Epic this repository planned`,
      `epic=${JSON.stringify(epicKey)}, root=${projectRoot}`,
    );
  }
  const context = `epic=${epicKey}, milestone=${milestone}, root=${projectRoot}`;

  // (a) the git index tracks the milestone's plan, live or archived.
  const candidates = [`specs/plan/${milestone}.md`, `specs/plan/archive/${milestone}.md`];
  const rel = candidates.find((c) => tracked(projectRoot, c));
  if (rel === undefined) {
    throw new EpicEditRefusal(
      `${milestone} (from ${epicKey}) has no plan tracked by the git index of ${projectRoot} — neither ${candidates.join(" nor ")} is tracked`,
      `edit ${epicKey} only from the repository that planned ${milestone}, with its plan committed`,
      context,
    );
  }
  const planContext = `${context}, plan=${rel}`;

  // (b) the plan, read from the index, carries `milestone: <M>`.
  const planBody = indexBlob(projectRoot, rel);
  if (planBody === null) {
    throw new EpicEditRefusal(`${milestone}'s plan ${rel} cannot be read from the git index of ${projectRoot}`, `commit ${rel} and run the edit again`, planContext);
  }
  const indexFrontmatter = parseFrontmatter(planBody);
  if (indexFrontmatter.milestone !== milestone) {
    throw new EpicEditRefusal(
      `${milestone}'s plan ${rel} in the git index carries milestone: ${String(indexFrontmatter.milestone ?? "<absent>")}, not milestone: ${milestone}`,
      `edit ${epicKey} only from the repository whose committed plan ${rel} carries milestone: ${milestone}`,
      `${planContext}, plan_milestone=${String(indexFrontmatter.milestone ?? "<absent>")}`,
    );
  }

  // (c) the plan's index and working-tree frontmatter agree.
  const planFile = join(projectRoot, rel);
  const diskFrontmatter = existsSync(planFile) ? parseFrontmatter(readFileSync(planFile, "utf-8")) : null;
  if (diskFrontmatter === null || JSON.stringify(diskFrontmatter) !== JSON.stringify(indexFrontmatter)) {
    throw new EpicEditRefusal(
      `${milestone}'s plan ${rel} frontmatter differs between the git index and the working tree`,
      `commit or discard the working-tree change to ${rel} so the index and the working tree agree, then run the edit again`,
      planContext,
    );
  }

  // (d) the binding is Jira mode.
  let mode: string;
  try {
    mode = adapterOf(projectRoot);
  } catch (e) {
    mode = `unknown (${e instanceof Error ? e.message : String(e)})`;
  }
  if (mode !== "jira") {
    throw new EpicEditRefusal(
      `the tracker binding of ${projectRoot} is ${mode}, not jira; an Epic is edited only from a Jira-mode repository`,
      `run the edit from the Jira-mode repository that planned ${milestone}`,
      `${planContext}, mode=${mode}`,
    );
  }

  // (e) the indexed plan was minted by this repository (AC-STE-729.12).
  const origin = indexFrontmatter.container_origin;
  if (origin !== "minted") {
    const shown = origin === undefined || origin === null ? "<absent>" : String(origin);
    throw new EpicEditRefusal(
      `${milestone}'s plan ${rel} in the git index carries container_origin: ${shown}, not container_origin: minted; an Epic is edited only from the repository that minted it`,
      `a person may add container_origin: minted to ${rel} only when this repository minted ${milestone}'s Epic, in a reviewed commit, then run the edit again`,
      `${planContext}, container_origin=${shown}`,
    );
  }

  const path = writeReceipt(projectRoot, epicEditReceipt(epicKey, { key: epicKey, milestone, plan: rel }));
  return ["default=forbidden", `options=${JSON.stringify([`Edit ${epicKey}`, `Skip ${epicKey}`])}`, announceReceipt(path)].join("\n");
}

if (import.meta.main) {
  try {
    let args: EpicEditArgs;
    try {
      args = parseEpicEditArgs(process.argv.slice(2));
    } catch {
      throw new EpicEditRefusal(
        "the arguments are not `<projectRoot> <EPIC-KEY>` (exactly two arguments)",
        `run ${USAGE}`,
        `argv=${process.argv.slice(2).join(" ")}`,
      );
    }
    process.stdout.write(`${editEpic(args)}\n`);
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }
}

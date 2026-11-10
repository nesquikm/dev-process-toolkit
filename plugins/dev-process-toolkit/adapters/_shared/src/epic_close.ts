// epic_close — STE-699.
//
// The one checked path for closing a shipped milestone's Jira Epic from the
// repository that planned it:
//
//   bun run epic_close.ts <projectRoot> <EPIC-KEY> --children <listing>
//
// Listed in `RECEIPT_WRITING_SUBCOMMANDS` (pre-tracker-write-gate) with no
// subcommand, so its whole CLI is one receipt-writing front door and the hook
// accepts exactly the argv above.

import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { normalizeContainerItems } from "./container_ownership";
import { parseFrontmatter } from "./frontmatter";
import { milestoneIdFromEpicKey } from "./milestone_token";
import { runPlanShipCoherenceProbe } from "./plan_ship_coherence";
import { refusalLine, shipStampVersion, siblingShipGate } from "./sibling_release";
import { readTrackerListing } from "./tracker_answer";
import { announceReceipt, oneLine, writeReceipt, type ReceiptInput } from "./tracker_receipts";

/** The one `epic-close` receipt the module writes once every check holds, naming the key. */
export function epicCloseReceipt(epicKey: string, evidence: unknown): ReceiptInput {
  return { kind: "epic-close", adapter: "jira", container: null, subject: epicKey, decision: "close", evidence };
}

/** The accepted argv after the module path. */
export interface EpicCloseArgs {
  projectRoot: string;
  epicKey: string;
  childrenListing: string;
}

/** Parses `<projectRoot> <EPIC-KEY> --children <listing>`; anything else throws. */
export function parseEpicCloseArgs(argv: readonly string[]): EpicCloseArgs {
  if (argv.length !== 4 || argv[2] !== "--children") {
    throw new Error("usage: epic_close.ts <projectRoot> <EPIC-KEY> --children <listing>");
  }
  return { projectRoot: argv[0]!, epicKey: argv[1]!, childrenListing: argv[3]! };
}

/** A refusal in the NFR-10 shape: verdict, `Remedy:`, `Context:` — one line each. */
export class EpicCloseRefusal extends Error {
  constructor(verdict: string, remedy: string, context: string) {
    super([`epic_close: ${oneLine(verdict)}`, `Remedy: ${oneLine(remedy)}`, `Context: ${oneLine(context)}, module=epic_close.ts`].join("\n"));
  }
}

const USAGE = "bun run epic_close.ts <projectRoot> <EPIC-KEY> --children <listing>";

/** Is `rel` tracked by the git index of `root`? Shared with epic_edit.ts. */
export function tracked(root: string, rel: string): boolean {
  const p = Bun.spawnSync(["git", "-C", root, "ls-files", "--", rel], { stdout: "pipe", stderr: "pipe" });
  return p.exitCode === 0 && p.stdout.toString().split("\n").some((l) => l.trim() === rel);
}

/** The blob the git index of `root` holds for `rel`, or null when it cannot be read. Shared with epic_edit.ts. */
export function indexBlob(root: string, rel: string): string | null {
  const p = Bun.spawnSync(["git", "-C", root, "show", `:${rel}`], { stdout: "pipe", stderr: "pipe" });
  return p.exitCode === 0 ? p.stdout.toString() : null;
}

/**
 * The blob HEAD holds for `rel`, or null when HEAD has none (no commit, or the
 * path is in no commit). The plan is read from here, never from the index
 * alone: a plan that is only `git add`-ed is in no commit. Shared with epic_edit.ts.
 */
export function headBlob(root: string, rel: string): string | null {
  const p = Bun.spawnSync(["git", "-C", root, "show", `HEAD:${rel}`], { stdout: "pipe", stderr: "pipe" });
  return p.exitCode === 0 ? p.stdout.toString() : null;
}

/**
 * Do the working tree and the index both hold exactly `headBody` (HEAD's blob)
 * for `rel`? The working-tree bytes are compared with `headBody`, and the index
 * with the working tree (`git diff --quiet -- <rel>`); any git failure is "no".
 * Shared with epic_edit.ts.
 */
export function equalsHead(root: string, rel: string, headBody: string): boolean {
  const file = join(root, rel);
  if (!existsSync(file) || readFileSync(file, "utf-8") !== headBody) return false;
  const p = Bun.spawnSync(["git", "-C", root, "diff", "--no-ext-diff", "--no-textconv", "--quiet", "--", rel], { stdout: "pipe", stderr: "pipe" });
  return p.exitCode === 0;
}

/** Read the --children listing file as JSON, or refuse naming it. */
function readListing(path: string, context: string): unknown {
  const remedy = "save the Epic's children as the tracker returns them (one page, or the JSON array of every page in order) and pass the file as --children <listing>";
  if (!existsSync(path)) throw new EpicCloseRefusal(`the --children listing ${path} does not exist`, remedy, context);
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch (e) {
    throw new EpicCloseRefusal(`the --children listing ${path} is not readable JSON: ${e instanceof Error ? e.message : String(e)}`, remedy, context);
  }
}

/**
 * Run the four checks (AC-STE-699.2); write and announce one `epic-close`
 * receipt when every one holds, otherwise throw an `EpicCloseRefusal`.
 * Returns the announcement line.
 */
export async function closeEpic(args: EpicCloseArgs): Promise<string> {
  const projectRoot = resolve(args.projectRoot);
  const { epicKey } = args;
  const milestone = milestoneIdFromEpicKey(epicKey);
  const context = `epic=${epicKey}, milestone=${milestone}, root=${projectRoot}`;
  const listing = readListing(args.childrenListing, `${context}, listing=${args.childrenListing}`);

  // (a) the git index tracks the milestone's plan, live or archived.
  const candidates = [`specs/plan/${milestone}.md`, `specs/plan/archive/${milestone}.md`];
  const rel = candidates.find((c) => tracked(projectRoot, c));
  if (rel === undefined) {
    throw new EpicCloseRefusal(
      `${milestone} (from ${epicKey}) has no plan tracked by the git index of ${projectRoot} — neither ${candidates.join(" nor ")} is tracked`,
      `close ${epicKey} only from the repository that planned and shipped ${milestone}, with its plan committed`,
      context,
    );
  }
  // (b) reads the plan from HEAD, never the index alone or the working-tree
  // copy: an uncommitted (or only staged) stamp must not satisfy the check, and
  // the coherence probe below reads the disk, so the index and the working tree
  // must both equal HEAD for the plan's path.
  const planBody = headBlob(projectRoot, rel);
  if (planBody === null) {
    throw new EpicCloseRefusal(
      `${milestone}'s plan ${rel} is in no commit: HEAD of ${projectRoot} holds no ${rel} (it is only staged)`,
      `commit ${rel} and run the close again`,
      `${context}, plan=${rel}`,
    );
  }
  const headFrontmatter = parseFrontmatter(planBody);
  const shippedIn = headFrontmatter.shipped_in;
  if (!equalsHead(projectRoot, rel, planBody)) {
    const planFile = join(projectRoot, rel);
    const diskShippedIn = existsSync(planFile) ? parseFrontmatter(readFileSync(planFile, "utf-8")).shipped_in : undefined;
    const indexBody = indexBlob(projectRoot, rel);
    const indexShippedIn = indexBody === null ? undefined : parseFrontmatter(indexBody).shipped_in;
    throw new EpicCloseRefusal(
      `${milestone}'s plan ${rel} in the index or the working tree differs from HEAD (HEAD shipped_in=${String(shippedIn ?? "<absent>")}, index shipped_in=${String(indexShippedIn ?? "<absent>")}, working tree shipped_in=${String(diskShippedIn ?? "<absent>")}); shipped_in is read from HEAD only`,
      `commit or discard the change to ${rel} so the index and the working tree both equal HEAD, then run the close again`,
      `${context}, plan=${rel}`,
    );
  }

  // (b) the plan's shipped_in passes the shipped plan/ship coherence rule.
  if (rel !== candidates[1]) {
    throw new EpicCloseRefusal(
      `${milestone}'s plan ${rel} is not archived, so its shipped_in is not graded by the plan/ship coherence rule`,
      `ship ${milestone} first (/ship-milestone archives the plan and stamps shipped_in)`,
      `${context}, plan=${rel}`,
    );
  }
  const report = await runPlanShipCoherenceProbe(projectRoot);
  const own = report.violations.filter(
    (v) => (v.kind === "corrupt_stamp" || v.kind === "unshipped_debt") && relative(projectRoot, v.file) === rel,
  );
  if (own.length > 0 || (shipStampVersion(shippedIn) === null && shippedIn !== "unreleased")) {
    const v = own[0];
    throw new EpicCloseRefusal(
      v ? v.reason : `${milestone}'s plan ${rel} carries no shipped_in stamp`,
      v ? refusalLine(v.message, "Remedy") : `ship ${milestone} so shipped_in is stamped with the CHANGELOG release that shipped it`,
      `${context}, plan=${rel}, shipped_in=${String(shippedIn ?? "<absent>")}`,
    );
  }

  // (c) every declared spans_repos sibling is idle by the shipped sibling-release check.
  const sibling = await siblingShipGate({ projectRoot, planBody, milestone, partial: false });
  if (sibling.refusal !== null) {
    const body = refusalLine(sibling.refusal, "Refusing") || sibling.refusal.split("\n")[0]!.replace(/^\/ship-milestone: /, "");
    throw new EpicCloseRefusal(
      `a declared sibling of ${milestone} is not idle — ${body}`,
      refusalLine(sibling.refusal, "Remedy"),
      `${context}, ${refusalLine(sibling.refusal, "Context")}`,
    );
  }

  // (d) at least one child, every child's status category done.
  const listingContext = `${context}, listing=${args.childrenListing}`;
  const read = readTrackerListing("jira", Array.isArray(listing) ? listing : [listing]);
  const childRemedy = `save ${epicKey}'s children as the tracker returns them, every page through the last, and pass the file as --children <listing>`;
  if (!read.ok) throw new EpicCloseRefusal(`the --children listing cannot be read: ${read.reason}`, childRemedy, listingContext);
  if (!read.last) throw new EpicCloseRefusal("the --children listing's final page does not prove it is the last page", childRemedy, listingContext);
  // A row proves it belongs to the Epic only through a string fields.parent.key;
  // a missing, null, keyless or bare-string parent proves nothing (parentless),
  // and a string naming another key proves it belongs elsewhere (foreign).
  const foreign: string[] = [];
  const parentless: string[] = [];
  for (const row of read.items) {
    const r = row as { key?: unknown; fields?: { parent?: { key?: unknown } | null } | null } | null;
    const parent = r?.fields?.parent?.key;
    if (typeof parent !== "string") parentless.push(String(r?.key));
    else if (parent.toUpperCase() !== epicKey.toUpperCase()) foreign.push(`${String(r?.key)} (parent ${parent})`);
  }
  if (parentless.length > 0) {
    const also = foreign.length > 0 ? `; ${foreign.length} row(s) name another parent than ${epicKey}: ${foreign.join(", ")}` : "";
    throw new EpicCloseRefusal(
      `${parentless.length} row(s) of the --children listing have their parent missing (no fields.parent.key naming ${epicKey}): ${parentless.join(", ")}${also}`,
      `list ${epicKey}'s children with the parent field requested (JQL \`parent = ${epicKey}\`, fields including parent) and pass the file as --children <listing>`,
      `${listingContext}, parent_missing=${parentless.join(",")}${foreign.length > 0 ? `, foreign=${foreign.join(",")}` : ""}`,
    );
  }
  if (foreign.length > 0) {
    throw new EpicCloseRefusal(
      `${foreign.length} row(s) of the --children listing name another parent than ${epicKey}: ${foreign.join(", ")}`,
      `list only ${epicKey}'s own children (parent ${epicKey}) and pass the file as --children <listing>`,
      `${listingContext}, foreign=${foreign.join(",")}`,
    );
  }
  let children: ReturnType<typeof normalizeContainerItems>;
  try {
    children = normalizeContainerItems(read.items, "jira");
  } catch (e) {
    throw new EpicCloseRefusal(`the --children listing is malformed: ${e instanceof Error ? e.message : String(e)}`, childRemedy, listingContext);
  }
  if (children.length === 0) {
    throw new EpicCloseRefusal(`the --children listing holds no child of ${epicKey}; an Epic with no child is not closed`, childRemedy, listingContext);
  }
  const open = children.filter((c) => c.closed !== true);
  if (open.length > 0) {
    throw new EpicCloseRefusal(
      `${open.length} child(ren) of ${epicKey} not in status category done: ${open.map((c) => c.key).join(", ")}`,
      `finish every child of ${epicKey} (status category done) before closing it`,
      `${listingContext}, open=${open.map((c) => c.key).join(",")}`,
    );
  }

  const path = writeReceipt(
    projectRoot,
    epicCloseReceipt(epicKey, { milestone, plan: rel, shippedIn, children: children.map((c) => c.key) }),
  );
  return announceReceipt(path);
}

if (import.meta.main) {
  try {
    let args: EpicCloseArgs;
    try {
      args = parseEpicCloseArgs(process.argv.slice(2));
    } catch {
      throw new EpicCloseRefusal(
        `the arguments are not \`<projectRoot> <EPIC-KEY> --children <listing>\` (a --children listing is required)`,
        `run ${USAGE}`,
        `argv=${process.argv.slice(2).join(" ")}`,
      );
    }
    process.stdout.write(`${await closeEpic(args)}\n`);
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }
}

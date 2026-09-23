// repoint_tracker_binding — STE-612.
//
// /setup's repoint flag (§ 0c) re-points a repository's tracker binding
// at another project of the same tracker. `docs/setup-reference.md` § 0c lists
// the preconditions for that flip; this module decides rows 1 to 7 in code
// from the tracker listings the session saves to files and passes in, then
// reports row 8 after the write.
//
// Front doors:
//   bun run adapters/_shared/src/repoint_tracker_binding.ts <projectRoot> <mode> <newProject>
//     --projects <file> --containers <file> [--issue-types <file>] [--statuses <file>]
//     [--labels <file>] [--peer <path>]… [--team <team>]
//   bun run adapters/_shared/src/repoint_tracker_binding.ts <projectRoot> --verify
//
// A repoint prints one `<n> PASS|REFUSE|NOT-APPLICABLE <reason>` line per row,
// rows 1 to 7 in order, and exits 1 when any row refuses — having written
// nothing. When none refuses it re-points CLAUDE.md through
// `writeTrackerSubsection` (STE-603) alone, writes one `repoint` receipt
// (STE-602), prints row 8's `8 …` report lines (branches and worktrees still
// binding the old project, and the legacy bindings that keep it alive), and
// prints the receipt's `dpt-receipt:` line last.
// A row whose input is absent, unreadable or malformed REFUSES; it never
// passes on an input it could not read.
//
// `--verify` re-reads `specs/tracker-config.yaml` against the status snapshot
// of this session's latest `repoint` receipt and prints `verify PASS|FAIL`.
// It writes nothing.
//
// Not every run is a repoint. A sub-section whose `project:` is absent or the
// `<deferred>` placeholder is a RESUME; one already bound to `<newProject>` is
// a DECLARE (STE-603). Neither runs the rows: the command prints `resume` or
// `declare` and hands straight to the sub-section writer.

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  listingProvider,
  milestoneLabel,
  planFileHeadingToMilestoneName,
  resolveAttachTarget,
} from "./attach_project_milestone";
import { readActiveSpecsFromGit, type ActiveSpecsRead } from "./active_plan_ship_ready";
import { nfr10Message } from "./dpt_version";
import { parseFrontmatter } from "./frontmatter";
import { parseMilestoneToken } from "./milestone_token";
import { parsePlanHeading } from "./plan_heading";
import { readListingFile, type ReadListing } from "./resolve_milestone_identity";
import { readTaskTrackingSection } from "./resolver_config";
import { writeTrackerSubsection } from "./setup/tracker_binding_write";
import { parseWorktreePorcelain, runGit } from "./target_repo";
import {
  epicTokenOutside,
  epicTokenPrefix,
  activeJiraKeyOf,
  foreignJiraKeyProject,
  jiraKeyOf,
  mdFiles,
  runTaskTrackingWorkspaceBindingPresentProbe,
} from "./task_tracking_workspace_binding_present";
import { readTrackerConfig } from "./tracker_config";
import { announceReceipt, oneLine, printable, readSessionReceipts, writeReceipt } from "./tracker_receipts";
import {
  locateSubsection,
  readWorkspaceBinding,
  type WorkspaceAdapterKey,
  type WorkspaceBinding,
} from "./workspace_binding";
import { readCompleteList, readTrackerPage, type CompleteListTool } from "./tracker_answer";

export type RowVerdict = "PASS" | "REFUSE" | "NOT-APPLICABLE";

export interface RowResult {
  row: number;
  verdict: RowVerdict;
  reason: string;
  /** Row 4 only: the tracker config's statuses, the snapshot the `repoint` receipt records. */
  statusSnapshot?: string[];
  /**
   * The inputs whose completeness this row relied on as ASSERTED by the
   * session (an `isLast: true` the session wrote), not proven by the tracker —
   * the receipt's `assertedCompleteness`. Absent when every input was proven.
   */
  asserted?: AssertedInput[];
}

/** An input no tracker tool lists, so its completeness can only be asserted by the session. */
export type AssertedInput = "statuses" | "labels";

/**
 * Appended to every printed row line that relied on an asserted-complete
 * input. Fixed and greppable: a reader can tell asserted from proven without
 * the FR. A row reading only measured inputs never carries it.
 */
export const COMPLETENESS_ASSERTED_MARKER = "[completeness asserted by the session, not proven by the tracker]";

export interface RepointArgs {
  projectRoot: string;
  mode: WorkspaceAdapterKey;
  newProject: string;
  projects?: string;
  containers?: string;
  issueTypes?: string;
  statuses?: string;
  labels?: string;
  peers: string[];
  team?: string;
}

/** A refusal raised before any row runs (arguments, mode, section). NFR-10 shape, every part flattened. */
export class RepointRefusal extends Error {
  constructor(verdict: string, remedy: string, context: string) {
    super(nfr10Message(oneLine(verdict), oneLine(remedy), oneLine(context)));
    this.name = "RepointRefusal";
  }
}

const USAGE =
  "bun run adapters/_shared/src/repoint_tracker_binding.ts <projectRoot> <jira|linear> <newProject> --projects <file> --containers <file> [--issue-types <file>] [--statuses <file>] [--labels <file>] [--peer <path>]… [--team <team>]";

const DEFERRED = "<deferred>";

// ------------------------------------------------------------------ inputs

/** One parsed input, or the reason it could not be read. */
type Input<T> = { ok: true; value: T } | { ok: false; reason: string };

function failed(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** The first line of a thrown value's message. */
function firstLine(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).split("\n")[0]!;
}

/** A filesystem error's code (`ENOENT`, …), else its message. */
function errCode(e: unknown): string {
  return (e as NodeJS.ErrnoException).code ?? (e as Error).message;
}

/** Read and JSON-parse the file at `path`; `label` opens every failure reason. */
function readJsonAt(label: string, path: string): Input<unknown> {
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch (e) {
    return failed(`${label} cannot be read (${errCode(e)})`);
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return failed(`${label} is not JSON (${(e as Error).message})`);
  }
}

/** Read and JSON-parse one listing file named by `flag`. */
function readJson(flag: string, path: string | undefined): Input<unknown> {
  if (path === undefined) return failed(`${flag} was not passed`);
  return readJsonAt(`${flag} ${path}`, path);
}

/** A parsed `{ <arrayKey>: [{ <field>: string }] }` listing, reduced to that field's values. */
function namedRows(label: string, v: unknown, arrayKey: string, field: string): Input<string[]> {
  if (!isObject(v) || !Array.isArray(v[arrayKey])) return failed(`${label} has no \`${arrayKey}\` array`);
  const out: string[] = [];
  for (const row of v[arrayKey] as unknown[]) {
    if (!isObject(row) || typeof row[field] !== "string") {
      return failed(`${label} carries a \`${arrayKey}\` row with no string \`${field}\``);
    }
    out.push(row[field] as string);
  }
  return { ok: true, value: out };
}

/**
 * A hand-assembled Jira listing (no Atlassian MCP tool lists a project's
 * statuses or labels) must itself CLAIM `isLast: true`; a missing claim
 * cannot prove absence. The claim is the session's assertion, never the
 * tracker's proof — the row that relies on it carries the marker.
 */
function notLastPage(label: string, v: Record<string, unknown>): Input<never> | undefined {
  return v.isLast === true ? undefined : failed(`${label} is not the last page (isLast is not true)`);
}

/**
 * One measured list answer (`readCompleteList`, tracker_answer.ts), proven
 * whole by the tracker or refused, reduced to each row's `field`.
 */
function readMeasuredList(flag: string, path: string | undefined, tool: CompleteListTool, field: string): Input<string[]> {
  const json = readJson(flag, path);
  if (!json.ok) return json;
  const label = `${flag} ${path}`;
  const read = readCompleteList(tool, json.value);
  if (!read.ok) return failed(`${label} is not a ${tool.split(":")[1]} answer: ${read.reason}`);
  if (!read.complete) return failed(`${label} does not prove it holds the whole list`);
  return namedRows(label, { rows: read.items }, "rows", field);
}

/**
 * `--projects`, both measured and read by the shared reader
 * (`tracker_answer.ts`): Jira the getVisibleJiraProjects answer `{ …, isLast,
 * values: [{ key }] }`, proven whole by `isLast`; Linear the list_projects
 * answer `{ projects: [{ name }], hasNextPage, cursor? }`, proven its last page.
 */
function readProjects(args: RepointArgs): Input<string[]> {
  if (args.mode === "linear") {
    const json = readJson("--projects", args.projects);
    if (!json.ok) return json;
    const label = `--projects ${args.projects}`;
    const read = readTrackerPage("linear", json.value, "projects");
    if (!read.ok) return failed(`${label} is not a list_projects answer: ${read.reason}`);
    if (!read.page.last) return failed(`${label} is not the last page (hasNextPage is true)`);
    return namedRows(label, { projects: read.page.items }, "projects", "name");
  }
  return readMeasuredList("--projects", args.projects, "jira:getVisibleJiraProjects", "key");
}

/**
 * `--labels` (Jira): `{ values: ["label", …], isLast: true }`, hand-assembled —
 * no Atlassian MCP tool lists a project's labels, so its completeness is the
 * session's assertion (row 6 carries COMPLETENESS_ASSERTED_MARKER).
 */
function readLabels(path: string | undefined): Input<string[]> {
  const json = readJson("--labels", path);
  if (!json.ok) return json;
  const label = `--labels ${path}`;
  const v = json.value;
  if (!isObject(v) || !Array.isArray(v.values)) return failed(`${label} has no \`values\` array`);
  const partial = notLastPage(label, v);
  if (partial !== undefined) return partial;
  if (!(v.values as unknown[]).every((l) => typeof l === "string")) {
    return failed(`${label} carries a non-string label`);
  }
  return { ok: true, value: v.values as string[] };
}

/** `--containers`: parsed by the one listing reader STE-608 ships. */
function readContainers(args: RepointArgs): Input<ReadListing> {
  if (args.containers === undefined) return failed("--containers was not passed");
  try {
    return {
      ok: true,
      value: readListingFile({ mode: args.mode, project: args.newProject, listingFile: args.containers }),
    };
  } catch (e) {
    return failed(firstLine(e));
  }
}

/** `.mcp.json` at `root`: its `mcpServers` map. */
function readMcpServers(root: string): Input<Record<string, unknown>> {
  const path = join(root, ".mcp.json");
  const json = readJsonAt(path, path);
  if (!json.ok) return json;
  const v = json.value;
  if (!isObject(v) || !isObject(v.mcpServers)) return failed(`${path} has no \`mcpServers\` map`);
  return { ok: true, value: v.mcpServers };
}

/** `specs/tracker-config.yaml` statuses, through the one config reader. Absent refuses. */
function readConfigStatuses(root: string): Input<string[]> {
  const specs = join(root, "specs");
  if (!existsSync(join(specs, "tracker-config.yaml"))) return failed("specs/tracker-config.yaml is absent");
  try {
    return { ok: true, value: readTrackerConfig(specs)!.statuses };
  } catch (e) {
    return failed(firstLine(e));
  }
}

/**
 * A refusal about what a PEER repository declares.
 *
 * MEASURED LIVE (2026-09-23): row 3 refused with `--peer <A> declares
 * jira_issue_type (none), not Task`. It named a disagreement and a file, and
 * named no action the running session could legally take — so the session took
 * the illegal one and edited the peer's CLAUDE.md. A guard's refusal INDUCED
 * the cross-repository write it exists to make visible.
 *
 * Every such reason is built here, so the six sites cannot drift apart: each
 * names what the peer declares, an action available to this repository's
 * operator alone, and the one action that is always available — dropping the
 * flag. `--peer` is an assertion about a repository this run does not own.
 */
function peerRefusal(path: string, observed: string, remedy: string): string {
  return `--peer ${path} ${observed}. ${remedy}; do not edit ${path} from here — a peer's CLAUDE.md belongs to that repository's operator — or re-run without --peer ${path}, which checks this repository alone.`;
}

/**
 * A refusal about the `--peer` FLAG rather than about what the peer declares.
 * It carries the always-available action and deliberately not the do-not-edit
 * clause: there is no declaration in dispute, and on a path that does not
 * exist the clause would be noise.
 */
const peerFlagRefusal = (path: string, observed: string): string =>
  `--peer ${path} ${observed}; name an existing peer root, or re-run without --peer ${path}.`;

/** A peer root: an existing directory holding a CLAUDE.md. */
function readPeer(path: string): Input<string> {
  let isDir = false;
  try {
    isDir = statSync(path).isDirectory();
  } catch {
    return failed(peerFlagRefusal(path, "does not exist"));
  }
  if (!isDir) return failed(peerFlagRefusal(path, "is not a directory"));
  if (!existsSync(join(path, "CLAUDE.md"))) return failed(peerFlagRefusal(path, "has no CLAUDE.md, so its binding cannot be checked"));
  return { ok: true, value: path };
}

/** The trimmed value of `key:` in `text`'s tracker sub-section, through `locateSubsection`. */
function subsectionValueIn(text: string, adapter: WorkspaceAdapterKey, key: string): string | undefined {
  const sub = locateSubsection(text.replace(/\r\n?/g, "\n").split("\n"), adapter) ?? [];
  for (const line of sub) {
    const m = /^([a-z_][a-z0-9_]*)\s*:\s*(.*)$/.exec(line);
    if (m && m[1] === key && m[2]!.trim().length > 0) return m[2]!.trim();
  }
  return undefined;
}

/** The trimmed value of `key:` in the tracker sub-section of the CLAUDE.md at `claudeMdPath`. */
function subsectionValue(claudeMdPath: string, adapter: WorkspaceAdapterKey, key: string): string | undefined {
  return subsectionValueIn(readFileSync(claudeMdPath, "utf-8"), adapter, key);
}

/** The `url` of the `.mcp.json` entry `name` under `root`. */
function mcpEntryUrl(root: string, name: string | undefined): Input<string> {
  const servers = readMcpServers(root);
  if (!servers.ok) return servers;
  if (name === undefined || name === "") return failed(`${join(root, "CLAUDE.md")} declares no mcp_server`);
  const entry = servers.value[name];
  if (entry === undefined) {
    return failed(`mcp_server ${name} names no entry in ${join(root, ".mcp.json")} (entries: ${Object.keys(servers.value).join(", ") || "none"})`);
  }
  if (!isObject(entry) || typeof entry.url !== "string") return failed(`${join(root, ".mcp.json")} entry ${name} has no string url`);
  return { ok: true, value: entry.url };
}

interface PlanFile {
  token: string;
  path: string;
}

/**
 * Plan files carrying a milestone token name, under `specs/plan/` (active,
 * never `archive/`) or `specs/plan/archive/` (archived), sorted by name.
 */
function planFiles(root: string, archived: boolean): PlanFile[] {
  const dir = archived ? join(root, "specs", "plan", "archive") : join(root, "specs", "plan");
  return mdFiles(dir)
    .map((name) => ({ token: name.slice(0, -3), path: join(dir, name) }))
    .filter((p) => parseMilestoneToken(p.token) !== null);
}

/** Numeric `M<N>` plan files, active or archived. */
function numericPlans(root: string, archived: boolean): PlanFile[] {
  return planFiles(root, archived).filter((p) => parseMilestoneToken(p.token)?.kind === "numeric");
}

// ------------------------------------------------------------------ routing

export type Route =
  | { kind: "resume" }
  | { kind: "declare" }
  | { kind: "rows"; oldProject: string; binding: Input<WorkspaceBinding> };

/**
 * Refuse a run that has no binding to move (`mode: none`, no section, or a
 * mode that differs from the one passed), else route it: resume, declare, or
 * the rows.
 */
export function routeRepoint(args: RepointArgs): Route {
  const claudeMd = join(args.projectRoot, "CLAUDE.md");
  const context = `projectRoot=${args.projectRoot}, mode=${args.mode}, newProject=${args.newProject}`;
  const section = readTaskTrackingSection(claudeMd);
  if (Object.keys(section).length === 0) {
    throw new RepointRefusal(
      "Refusing: CLAUDE.md has no `## Task Tracking` section — there is no tracker binding to re-point.",
      "creating a binding is fresh setup, not a repoint: run /dev-process-toolkit:setup instead.",
      `${context}, section=missing`,
    );
  }
  const mode = section["mode"] ?? "";
  if (mode === "" || mode === "none") {
    throw new RepointRefusal(
      "Refusing: `## Task Tracking` is in `mode: none` — there is no tracker binding to re-point.",
      "binding a tracker is fresh setup, not a repoint: run /dev-process-toolkit:setup to choose a tracker mode.",
      `${context}, declared_mode=${mode === "" ? "absent" : mode}`,
    );
  }
  if (mode !== args.mode) {
    throw new RepointRefusal(
      `Refusing: CLAUDE.md declares \`mode: ${mode}\`, not the \`${args.mode}\` this run names — a repoint never changes the tracker mode.`,
      `pass the declared mode, or switch trackers through /dev-process-toolkit:setup --migrate.`,
      `${context}, declared_mode=${mode}`,
    );
  }

  let binding: Input<WorkspaceBinding>;
  try {
    binding = { ok: true, value: readWorkspaceBinding(claudeMd, args.mode) };
  } catch (e) {
    binding = failed(firstLine(e));
  }
  // A refused declaration still names its project: read the line the reader read.
  const project = binding.ok ? binding.value.project : subsectionValue(claudeMd, args.mode, "project");
  if (project === undefined || project === DEFERRED) return { kind: "resume" };
  if (project === args.newProject) return { kind: "declare" };
  return { kind: "rows", oldProject: project, binding };
}

// ------------------------------------------------------------------ rows

function row(n: number, verdict: RowVerdict, reason: string): RowResult {
  return { row: n, verdict, reason: oneLine(reason) };
}

/** Probe #25's violation reasons for the tree at `root`, joined; `undefined` when it reports none. */
async function probe25Violations(root: string): Promise<string | undefined> {
  const report = await runTaskTrackingWorkspaceBindingPresentProbe(root);
  if (report.violations.length === 0) return undefined;
  return report.violations.map((v) => v.reason).join("; ");
}

/** Row 2: probe #25 in process here and at each peer, then each peer's project and tag. */
async function decideRow2(args: RepointArgs, binding: Input<WorkspaceBinding>, peers: Input<string>[]): Promise<RowResult> {
  const own = await probe25Violations(args.projectRoot);
  if (own !== undefined) return row(2, "REFUSE", `probe #25 reports: ${own}`);
  if (!binding.ok) return row(2, "REFUSE", binding.reason);
  const tag = binding.value.repoTag;
  if (tag === undefined) return row(2, "REFUSE", "the target is shared and this repository declares no repo_tag");
  for (const peer of peers) {
    if (!peer.ok) return row(2, "REFUSE", peer.reason);
    const path = peer.value;
    const theirs = await probe25Violations(path);
    if (theirs !== undefined) return row(2, "REFUSE", peerRefusal(path, `reports probe #25 violations: ${theirs}`, "That peer's own operator repairs its binding"));
    let pb: WorkspaceBinding;
    try {
      pb = readWorkspaceBinding(join(path, "CLAUDE.md"), args.mode);
    } catch (e) {
      return row(2, "REFUSE", peerRefusal(path, `has an unreadable binding: ${firstLine(e)}`, "That peer's own operator repairs it"));
    }
    if (pb.project !== args.newProject) {
      return row(2, "REFUSE", peerRefusal(path, `binds project ${pb.project ?? "(none)"}, not ${args.newProject}`, `Repoint this repository to the project that peer binds, or have that peer's operator repoint it to ${args.newProject}`));
    }
    if (pb.repoTag === undefined) return row(2, "REFUSE", peerRefusal(path, "declares no repo_tag", "That peer is not bootstrapped for a shared container: its own operator declares a repo_tag there"));
    if (pb.repoTag === tag) return row(2, "REFUSE", peerRefusal(path, `declares the same repo_tag ${tag}, which no two repositories in one container may share`, "Change THIS repository's repo_tag to one nothing else uses"));
  }
  return row(2, "PASS", peers.length === 0 ? "peers=0 (not checked)" : `peers=${peers.length}, each bound to ${args.newProject} under a distinct tag`);
}

/**
 * Row 3 (Jira): `jira_issue_type` declared, offered by `--issue-types` (the
 * measured getJiraProjectIssueTypesMetadata answer, proven whole), and the
 * same at every peer.
 */
function decideRow3(args: RepointArgs, peers: Input<string>[]): RowResult {
  const types = readMeasuredList("--issue-types", args.issueTypes, "jira:getJiraProjectIssueTypesMetadata", "name");
  if (!types.ok) return row(3, "REFUSE", types.reason);
  const own = subsectionValue(join(args.projectRoot, "CLAUDE.md"), "jira", "jira_issue_type");
  if (own === undefined) return row(3, "REFUSE", "this repository declares no jira_issue_type");
  if (!types.value.includes(own)) {
    return row(3, "REFUSE", `jira_issue_type ${own} is not offered by ${args.newProject} (--issue-types lists ${types.value.join(", ")})`);
  }
  for (const peer of peers) {
    if (!peer.ok) return row(3, "REFUSE", peer.reason);
    const theirs = subsectionValue(join(peer.value, "CLAUDE.md"), "jira", "jira_issue_type");
    if (theirs !== own) {
      return row(
        3,
        "REFUSE",
        theirs === undefined
          ? peerRefusal(peer.value, `declares no jira_issue_type, and this repository declares ${own}`, "That peer is not bootstrapped for this shared space: its own operator declares it")
          : peerRefusal(peer.value, `declares jira_issue_type ${theirs}, and this repository declares ${own}`, `Set THIS repository's jira_issue_type to ${theirs} if the peer is right, or have that peer's operator change theirs`),
      );
    }
  }
  return row(3, "PASS", `jira_issue_type ${own} is offered by ${args.newProject}${peers.length > 0 ? " and declared by every peer" : ""}`);
}

/** Row 5: `mcp_server` names an entry in `.mcp.json`; each peer's entry points at the same URL. */
function decideRow5(args: RepointArgs, peers: Input<string>[]): RowResult {
  const ownName = readTaskTrackingSection(join(args.projectRoot, "CLAUDE.md"))["mcp_server"];
  const own = mcpEntryUrl(args.projectRoot, ownName);
  if (!own.ok) return row(5, "REFUSE", own.reason);
  const spellings = new Set([ownName!]);
  for (const peer of peers) {
    if (!peer.ok) return row(5, "REFUSE", peer.reason);
    const theirName = readTaskTrackingSection(join(peer.value, "CLAUDE.md"))["mcp_server"];
    const theirs = mcpEntryUrl(peer.value, theirName);
    if (!theirs.ok) return row(5, "REFUSE", peerRefusal(peer.value, `has an unreadable mcp entry: ${theirs.reason}`, "That peer's own operator repairs it"));
    if (theirs.value !== own.value) {
      return row(5, "REFUSE", peerRefusal(peer.value, `has its ${theirName} entry pointing at ${theirs.value}, not ${own.value}`, "Point THIS repository's entry at that URL if the peer is right, or have that peer's operator change theirs"));
    }
    spellings.add(theirName!);
  }
  const names = [...spellings];
  return row(
    5,
    "PASS",
    `one server ${own.value}${names.length > 1 ? ` under ${names.length} spellings: ${names.join(", ")}` : ` as ${names[0]}`}`,
  );
}

/** Where a spec is live, for a row 7 line: nothing when this checkout's own tree holds it, else every source. */
function whereLive(root: string, sources: readonly string[]): string {
  const own = new Set([`worktree ${resolve(root)}`, `worktree ${realpathOr(root)}`]);
  if (sources.some((src) => own.has(src))) return "";
  return ` (on ${sources.join(", ")})`;
}

function realpathOr(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/**
 * Row 7: no active plan or FR is left in the old container. Each active plan's
 * container is resolved through `resolveAttachTarget` over the `--containers`
 * listing (the attach front door's read-only provider); an Epic-keyed token
 * outside the new project's Epic-token prefix is an old-project container.
 * Active FRs bound to an unresolved plan are named with it. Jira: an active FR
 * whose tracker key belongs to another project refuses. The two Jira checks
 * are probe #25's key-prefix leg's own (`epicTokenOutside`,
 * `foreignJiraKeyProject`), so the probe and this row cannot disagree.
 */
async function decideRow7(args: RepointArgs, listing: ReadListing): Promise<RowResult> {
  // Every source the repository holds work in (M_685ff6 review): a plan or FR
  // active on an unmerged branch, a second worktree or a remote-tracking ref
  // keeps creating in the old project after the flip, so it refuses too. A
  // read failure refuses — never read as "no active work".
  let specs: ActiveSpecsRead;
  try {
    specs = await readActiveSpecsFromGit(args.projectRoot);
  } catch (e) {
    return row(7, "REFUSE", `the repository's git state cannot be read (${firstLine(e)}), so active work on other branches or worktrees is unknown`);
  }
  const frs = specs.frs.map((f) => {
    const fm = parseFrontmatter(f.body, { lenient: true });
    const milestone = typeof fm["milestone"] === "string" ? (fm["milestone"] as string).trim() : "";
    return { id: f.name, milestone, jiraKey: activeJiraKeyOf(f.body), where: whereLive(args.projectRoot, f.sources) };
  });
  const provider = listingProvider(args.mode, listing);
  const newPrefix = args.mode === "jira" ? epicTokenPrefix(args.newProject) : undefined;
  const stranded: string[] = [];
  for (const spec of specs.plans) {
    const plan = { token: spec.name, where: whereLive(args.projectRoot, spec.sources) };
    let why: string | undefined;
    if (newPrefix !== undefined && epicTokenOutside(plan.token, newPrefix)) {
      why = `its container is outside ${args.newProject}`;
    } else {
      let name: string | undefined;
      const heading = parsePlanHeading(spec.body);
      if (heading === null) {
        why = `has no milestone heading to resolve (expected \`## ${plan.token} — <title>\`)`;
      } else {
        name = heading;
      }
      if (name !== undefined) {
        try {
          await resolveAttachTarget(provider, args.newProject, name, { sleep: async () => {} });
        } catch (e) {
          why = `resolves to no container in --containers (${firstLine(e)})`;
        }
      }
    }
    if (why === undefined) continue;
    const bound = frs.filter((f) => f.milestone === plan.token).map((f) => `${f.id}${f.where}`);
    stranded.push(`plan ${plan.token}${plan.where} ${why}${bound.length > 0 ? `; active FRs ${bound.join(", ")}` : ""}`);
  }
  if (args.mode === "jira") {
    for (const fr of frs) {
      if (fr.jiraKey !== undefined && foreignJiraKeyProject(fr.jiraKey, args.newProject) !== undefined) {
        stranded.push(`active FR ${fr.id}${fr.where} is keyed ${fr.jiraKey}, not ${args.newProject}`);
      }
    }
  }
  if (stranded.length > 0) {
    return row(7, "REFUSE", `active work left in the old container: ${stranded.map(oneLine).join("; ")}`);
  }
  return row(7, "PASS", `every active plan resolves in --containers (${listing.rowKeys.length} rows); no active FR is keyed outside ${args.newProject}`);
}

/** Row 1: the new project is visible in `--projects`. */
function decideRow1(args: RepointArgs): RowResult {
  const projects = readProjects(args);
  if (!projects.ok) return row(1, "REFUSE", projects.reason);
  if (!projects.value.includes(args.newProject)) {
    return row(1, "REFUSE", `project ${args.newProject} is absent from the --projects listing`);
  }
  return row(1, "PASS", `project ${args.newProject} is listed`);
}

/**
 * `--statuses`: Linear the measured list_issue_statuses answer — a BARE array,
 * the whole list (read by `tracker_answer.ts`); Jira a hand-assembled
 * `{ statuses: [{ name }], isLast: true }` — no Atlassian MCP tool lists a
 * project's statuses, so its completeness is asserted, never proven.
 */
function readStatuses(args: RepointArgs): Input<string[]> {
  if (args.mode === "linear") return readMeasuredList("--statuses", args.statuses, "linear:list_issue_statuses", "name");
  const json = readJson("--statuses", args.statuses);
  if (!json.ok) return json;
  const label = `--statuses ${args.statuses}`;
  const rows = namedRows(label, json.value, "statuses", "name");
  if (!rows.ok) return rows;
  return notLastPage(label, json.value as Record<string, unknown>) ?? rows;
}

/** Mark a row that relied on an asserted-complete input: the marker on its line, the input on the row. */
function assertedRow(r: RowResult, input: AssertedInput): RowResult {
  return { ...r, reason: `${r.reason} ${COMPLETENESS_ASSERTED_MARKER}`, asserted: [input] };
}

/** Row 4: the tracker config covers the new project's statuses; the row carries the config's status snapshot. */
function decideRow4(args: RepointArgs): RowResult {
  const statuses = readStatuses(args);
  const config = readConfigStatuses(args.projectRoot);
  if (!statuses.ok) return row(4, "REFUSE", statuses.reason);
  // From here the row relies on the status list: asserted in Jira, proven in Linear.
  const mark = (r: RowResult): RowResult => (args.mode === "jira" ? assertedRow(r, "statuses") : r);
  if (!config.ok) return mark(row(4, "REFUSE", `${config.reason}; statuses missing: ${statuses.value.join(", ")}`));
  const missing = statuses.value.filter((s) => !config.value.includes(s));
  const r4 =
    missing.length > 0
      ? row(4, "REFUSE", `specs/tracker-config.yaml lacks ${args.newProject} statuses: ${missing.join(", ")}`)
      : row(4, "PASS", `config statuses ${config.value.join(", ")} cover ${args.newProject}'s ${statuses.value.join(", ")}`);
  return { ...mark(r4), statusSnapshot: [...config.value] };
}

/**
 * Row 6: no active numeric plan collides with a milestone the new project
 * already holds (Jira: a `--labels` label; Linear: a `--containers` name).
 */
function decideRow6(args: RepointArgs, labels: Input<string[]> | undefined, containers: Input<ReadListing>): RowResult {
  let taken: Set<string>;
  let key: (p: PlanFile) => string;
  if (labels !== undefined) {
    if (!labels.ok) return row(6, "REFUSE", labels.reason);
    taken = new Set(labels.value);
    key = (p) => milestoneLabel(p.token);
  } else {
    if (!containers.ok) return row(6, "REFUSE", containers.reason);
    // A full list_milestones window proves nothing about the milestones past
    // it (the shared reader's completeness, via readListingFile): a collision
    // there would be unseen, so the row cannot pass on it.
    if (!containers.value.complete) {
      return row(6, "REFUSE", `--containers holds ${containers.value.rowKeys.length} milestones — a full list_milestones window, which proves nothing past it — so no collision can be ruled out`);
    }
    taken = new Set((containers.value.linearRows ?? []).map((r) => r.name));
    key = (p) => {
      try {
        return planFileHeadingToMilestoneName(p.path);
      } catch {
        return p.token;
      }
    };
  }
  const collide = numericPlans(args.projectRoot, false).filter((p) => taken.has(key(p)));
  const overlap = numericPlans(args.projectRoot, true).filter((p) => taken.has(key(p))).length;
  // The Jira label list is hand-assembled: the row relies on its asserted completeness.
  const mark = (r: RowResult): RowResult => (labels !== undefined ? assertedRow(r, "labels") : r);
  if (collide.length > 0) {
    return mark(row(6, "REFUSE", `active numeric plan(s) collide with ${args.newProject}: ${collide.map((p) => `${p.token} (${key(p)})`).join(", ")}`));
  }
  return mark(row(6, "PASS", `no active numeric plan collides; overlap=${overlap} archived tokens (legacy history)`));
}

/**
 * Decide rows 1 to 7 from the parsed inputs and the repository tree. Each row
 * reads its own inputs first and refuses on any it cannot read.
 */
export async function decideRows(args: RepointArgs, route: Extract<Route, { kind: "rows" }>): Promise<RowResult[]> {
  const results: RowResult[] = [];
  const peers = args.peers.map(readPeer);
  const containers = readContainers(args);
  const labels = args.mode === "jira" ? readLabels(args.labels) : undefined;

  // Shared-ness: a declared tag, a listed container, a listed label (Jira), or a named peer.
  // A listing that cannot be read cannot prove the target empty, so it counts as shared.
  const binding = route.binding;
  const empties: string[] = [];
  let shared = args.peers.length > 0 || !binding.ok || binding.value.repoTag !== undefined;
  if (!containers.ok || containers.value.rowKeys.length > 0) shared = true;
  else empties.push("--containers lists 0 rows");
  if (labels !== undefined) {
    if (!labels.ok || labels.value.length > 0) shared = true;
    else empties.push("--labels lists 0 rows");
  }
  const unshared = `target not shared: ${[...empties, "no --peer", "no repo_tag"].join(", ")}`;

  // Row 1 — the new project is visible.
  results.push(decideRow1(args));

  // Row 2 — probe #25 green here and at every peer; a shared target carries a tag;
  // every peer binds the new project under a distinct tag.
  if (!shared) results.push(row(2, "NOT-APPLICABLE", unshared));
  else results.push(await decideRow2(args, binding, peers));

  // Row 3 — the issue type (Jira only, shared targets only).
  if (args.mode === "linear") results.push(row(3, "NOT-APPLICABLE", "Linear has no issue-type override"));
  else if (!shared) results.push(row(3, "NOT-APPLICABLE", unshared));
  else results.push(decideRow3(args, peers));

  // Row 4 — the tracker config and the new project's statuses.
  results.push(decideRow4(args));

  // Row 5 — one server: mcp_server names an entry here, and every peer's entry has the same URL.
  results.push(decideRow5(args, peers));

  // Row 6 — milestone collisions (Jira: --labels; Linear: --containers).
  results.push(decideRow6(args, labels, containers));

  // Row 7 — the old container.
  if (!containers.ok) results.push(row(7, "REFUSE", containers.reason));
  else results.push(await decideRow7(args, containers.value));

  return results;
}

// ------------------------------------------------------------------ the write

/** The sub-section fields every write of this command sets: the new project, and the team when passed. */
function bindingFields(args: RepointArgs): { project: string; team?: string } {
  return { project: args.newProject, ...(args.team !== undefined ? { team: args.team } : {}) };
}

/**
 * Every row passed: flip the binding through the one sub-section writer
 * (STE-603) — it re-renders the stop paragraph for the new project and keeps
 * every other line — then record one `repoint` receipt (STE-602). Returns the
 * receipt's path. A receipt that cannot be written after CLAUDE.md was
 * refuses, naming the file to revert.
 */
export function writeRepoint(args: RepointArgs, oldProject: string, rows: RowResult[]): string {
  const claudeMd = join(args.projectRoot, "CLAUDE.md");
  writeTrackerSubsection(claudeMd, args.mode, bindingFields(args));
  const statusSnapshot = rows.find((r) => r.row === 4)?.statusSnapshot ?? [];
  try {
    return writeReceipt(args.projectRoot, {
      kind: "repoint",
      adapter: args.mode,
      container: args.newProject,
      subject: claudeMd,
      decision: "repoint",
      evidence: {
        oldProject,
        newProject: args.newProject,
        ...(args.team !== undefined ? { team: args.team } : {}),
        statusSnapshot,
        trackerConfig: join("specs", "tracker-config.yaml"),
        rows: rows.map((r) => ({ row: r.row, verdict: r.verdict })),
        // Each input whose completeness the session asserted rather than the
        // tracker proved (COMPLETENESS_ASSERTED_MARKER on its row line).
        assertedCompleteness: rows.flatMap((r) => r.asserted ?? []),
      },
    });
  } catch (e) {
    throw new RepointRefusal(
      `Refusing: CLAUDE.md was re-pointed from ${printable(oldProject)} to ${printable(args.newProject)}, but the \`repoint\` receipt could not be written (${firstLine(e)}).`,
      `revert ${claudeMd} (git checkout -- CLAUDE.md), fix the receipt store, then re-run.`,
      `projectRoot=${args.projectRoot}, mode=${args.mode}, oldProject=${oldProject}, newProject=${args.newProject}`,
    );
  }
}

// ------------------------------------------------------------------ row 8

const GIT_TIMEOUT_MS = 10_000;

/** Run git through the shared runner; stdout, or the reason it failed. */
function gitRead(cwd: string, args: string[], input?: string): Input<Buffer> {
  let proc;
  try {
    proc = runGit(cwd, args, { timeoutMs: GIT_TIMEOUT_MS, ...(input !== undefined ? { input } : {}) });
  } catch (e) {
    return failed(`git ${args[0]} failed (${e instanceof Error ? e.message : String(e)})`);
  }
  if (proc.error) return failed(`git ${args[0]} failed (${proc.error.message})`);
  if (proc.status !== 0) return failed(`git ${args[0]} exited ${proc.status ?? "on a signal"} (${proc.stderr.toString("utf-8").trim()})`);
  return { ok: true, value: proc.stdout };
}

/** Local branches other than the current one whose committed CLAUDE.md still binds `oldProject`. */
function staleBranches(root: string, adapter: WorkspaceAdapterKey, oldProject: string): Input<string[]> {
  const refs = gitRead(root, ["for-each-ref", "--format=%(HEAD) %(refname)", "refs/heads"]);
  if (!refs.ok) return refs;
  const names: string[] = [];
  for (const line of refs.value.toString("utf-8").split("\n")) {
    if (line.length < 3 || line.startsWith("*")) continue; // the branch being repointed is not stale
    names.push(line.slice(2).replace(/^refs\/heads\//, ""));
  }
  if (names.length === 0) return { ok: true, value: [] };
  const batch = gitRead(root, ["cat-file", "--batch"], names.map((n) => `refs/heads/${n}:CLAUDE.md\n`).join(""));
  if (!batch.ok) return batch;
  const out = batch.value;
  const stale: string[] = [];
  let pos = 0;
  for (const name of names) {
    const nl = out.indexOf(0x0a, pos);
    if (nl < 0) return failed(`git cat-file --batch ended before refs/heads/${name}:CLAUDE.md`);
    const header = out.subarray(pos, nl).toString("utf-8").split(" ");
    pos = nl + 1;
    if (header.length !== 3) continue; // `<object> missing`: the branch has no CLAUDE.md
    const size = Number(header[2]);
    if (header[1] !== "blob" || !Number.isInteger(size)) {
      return failed(`git cat-file --batch answered ${header.join(" ")} for refs/heads/${name}:CLAUDE.md`);
    }
    const text = out.subarray(pos, pos + size).toString("utf-8");
    pos += size + 1;
    if (subsectionValueIn(text, adapter, "project") === oldProject) stale.push(name);
  }
  return { ok: true, value: stale };
}

function realOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** Worktrees other than `root` whose working-tree CLAUDE.md still binds `oldProject`. */
function staleWorktrees(root: string, adapter: WorkspaceAdapterKey, oldProject: string): Input<string[]> {
  const list = gitRead(root, ["worktree", "list", "--porcelain"]);
  if (!list.ok) return list;
  const self = realOrSelf(root);
  const stale: string[] = [];
  for (const wt of parseWorktreePorcelain(list.value.toString("utf-8"))) {
    if (wt.bare || realOrSelf(wt.path) === self) continue;
    let text: string;
    try {
      text = readFileSync(join(wt.path, "CLAUDE.md"), "utf-8");
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (code === "ENOENT") continue; // no CLAUDE.md there binds nothing
      return failed(`${join(wt.path, "CLAUDE.md")} cannot be read (${errCode(e)})`);
    }
    if (subsectionValueIn(text, adapter, "project") === oldProject) stale.push(wt.path);
  }
  return { ok: true, value: stale };
}

/** Archived FR files under `specs/frs/archive/` whose Jira key (`jiraKeyOf`) carries `oldProject`'s prefix. */
function archivedFrsKeyedTo(root: string, oldProject: string): number {
  const dir = join(root, "specs", "frs", "archive");
  return mdFiles(dir).filter((name) =>
    jiraKeyOf(readFileSync(join(dir, name), "utf-8"))?.startsWith(`${oldProject}-`) === true,
  ).length;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Row 8, the report (printed after a successful write): every local branch and
 * every other worktree whose CLAUDE.md still binds the old project — zero is
 * printed, never omitted; a git read failure is printed as such — then the
 * count of legacy bindings (Jira: archived FRs keyed to the old project;
 * Linear: archived plans) and why the old project must stay.
 */
export function reportRow8(args: RepointArgs, oldProject: string): string[] {
  const old = printable(oldProject);
  const lines: string[] = [];
  const branches = staleBranches(args.projectRoot, args.mode, oldProject);
  lines.push(
    branches.ok
      ? `8 ${plural(branches.value.length, "branch still binds", "branches still bind")} ${old}${branches.value.length > 0 ? `: ${branches.value.map(oneLine).join(", ")}` : ""}`
      : `8 branches could not be read (${oneLine(branches.reason)}) — stale branches still binding ${old} are unknown`,
  );
  const worktrees = staleWorktrees(args.projectRoot, args.mode, oldProject);
  lines.push(
    worktrees.ok
      ? `8 ${plural(worktrees.value.length, "worktree still binds", "worktrees still bind")} ${old}${worktrees.value.length > 0 ? `: ${worktrees.value.map(oneLine).join(", ")}` : ""}`
      : `8 worktrees could not be read (${oneLine(worktrees.reason)}) — stale worktrees still binding ${old} are unknown`,
  );
  const keep = `the old project ${old} must not be archived or deleted: those bindings are read by key`;
  lines.push(
    args.mode === "jira"
      ? `8 ${plural(archivedFrsKeyedTo(args.projectRoot, oldProject), "archived FR is", "archived FRs are")} keyed ${old}-*; ${keep}`
      : `8 ${plural(planFiles(args.projectRoot, true).length, "archived plan was", "archived plans were")} recorded under ${old}; ${keep}`,
  );
  return lines.map(oneLine);
}

// ------------------------------------------------------------------ verify

/**
 * `--verify`: re-read `specs/tracker-config.yaml` against the status snapshot
 * of this session's latest `repoint` receipt (step 7f may have rewritten the
 * config). Returns the statuses the config dropped — empty when intact. No
 * receipt refuses: what was not recorded cannot be verified. Writes nothing.
 */
export function verifyRepoint(projectRoot: string): string[] {
  const root = resolve(projectRoot);
  const context = `projectRoot=${root}`;
  const sessionId = process.env.CLAUDE_CODE_SESSION_ID ?? "";
  let latest: string[] | undefined;
  if (sessionId !== "") {
    for (const r of readSessionReceipts(root, sessionId).receipts) {
      if (r.kind !== "repoint" || !isObject(r.evidence)) continue;
      const snap = r.evidence.statusSnapshot;
      if (Array.isArray(snap) && snap.every((x) => typeof x === "string")) latest = snap as string[];
    }
  }
  if (latest === undefined) {
    throw new RepointRefusal(
      "Refusing: no `repoint` receipt for this session — `--verify` cannot verify what was not recorded.",
      `run ${USAGE} first, then re-run --verify.`,
      `${context}, sessionId=${sessionId === "" ? "<unset>" : sessionId}`,
    );
  }
  const config = readConfigStatuses(root);
  if (!config.ok) {
    throw new RepointRefusal(`Refusing: cannot read the tracker config — ${config.reason}.`, "restore specs/tracker-config.yaml, then re-run --verify.", context);
  }
  const present = new Set(config.value);
  return latest.filter((s) => !present.has(s));
}

// ------------------------------------------------------------------ front door

/** Flatten each line of a refusal onto itself, keeping the NFR-10 line breaks. */
function oneLineParts(message: string): string {
  return message.split("\n").map(oneLine).join("\n");
}

export function parseRepointArgs(argv: string[]): RepointArgs {
  const [projectRoot, mode, newProject, ...rest] = argv;
  const context = `argv=${argv.join(" ")}`;
  if (!projectRoot || (mode !== "jira" && mode !== "linear") || !newProject) {
    throw new RepointRefusal(
      "Refusing: invalid arguments — expected <projectRoot> <jira|linear> <newProject>.",
      `run ${USAGE}`,
      context,
    );
  }
  const args: RepointArgs = { projectRoot: resolve(projectRoot), mode, newProject, peers: [] };
  const single: Record<string, "projects" | "containers" | "issueTypes" | "statuses" | "labels" | "team"> = {
    "--projects": "projects",
    "--containers": "containers",
    "--issue-types": "issueTypes",
    "--statuses": "statuses",
    "--labels": "labels",
    "--team": "team",
  };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i]!;
    const value = rest[i + 1];
    if (value === undefined || (flag !== "--peer" && !(flag in single))) {
      throw new RepointRefusal(
        `Refusing: invalid arguments — ${value === undefined ? `${flag} has no value` : `unknown flag ${flag}`}.`,
        `run ${USAGE}`,
        context,
      );
    }
    if (flag === "--peer") args.peers.push(value);
    else args[single[flag]!] = value;
    i++;
  }
  return args;
}

if (import.meta.main) {
  try {
    const argv = process.argv.slice(2);
    if (argv.length === 2 && argv[1] === "--verify") {
      const dropped = verifyRepoint(argv[0]!);
      if (dropped.length === 0) {
        process.stdout.write("verify PASS specs/tracker-config.yaml carries every status in the repoint snapshot\n");
        process.exit(0);
      }
      process.stdout.write(`verify FAIL specs/tracker-config.yaml dropped: ${dropped.map(printable).join(", ")}\n`);
      process.exit(1);
    }
    const args = parseRepointArgs(argv);
    const route = routeRepoint(args);
    if (route.kind !== "rows") {
      // Resume and declare hand straight to the one sub-section writer (STE-603).
      writeTrackerSubsection(join(args.projectRoot, "CLAUDE.md"), args.mode, bindingFields(args));
      process.stdout.write(`${route.kind}\n`);
      process.exit(0);
    }
    const rows = await decideRows(args, route);
    for (const r of rows) process.stdout.write(`${r.row} ${r.verdict} ${r.reason}\n`);
    if (rows.some((r) => r.verdict === "REFUSE")) process.exit(1);
    const receipt = writeRepoint(args, route.oldProject, rows);
    for (const line of reportRow8(args, route.oldProject)) process.stdout.write(`${line}\n`);
    process.stdout.write(`${announceReceipt(receipt)}\n`);
    process.exit(0);
  } catch (e) {
    process.stderr.write(`${oneLineParts(e instanceof Error ? e.message : String(e))}\n`);
    process.exit(1);
  }
}

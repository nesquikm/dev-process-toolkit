// active_plan_ship_ready — /gate-check probe #75 (STE-462).
//
// Invariant (AC-STE-462.1): walk every ACTIVE plan under `specs/plan/`
// (numeric `M<N>` and epic-keyed `M_<epic-key>` filenames alike) and classify
// it ship-ready ⇔ zero ACTIVE FRs (`specs/frs/*.md`) carry its milestone
// token in frontmatter AND ≥ 1 ARCHIVED FR (`specs/frs/archive/*.md`) does.
//
// Severity: warning (NotesOnly) — `violations` is ALWAYS empty; hits render a
// single NOTES row. File reads, plus read-only git reads of a declared
// `spans_repos:` sibling (STE-609, never a fetch) — no network, no LLM judgment.
//
//   - `ship_state: parked` on the active plan → excluded from the ship-ready
//     row AND from shipReadyMilestones (both consumers — /gate-check and
//     /implement — share this one predicate); surfaced via the parked-note
//     idiom of `plan_ship_coherence.ts` (`parked milestones: <list>`).
//   - `shipped_in: null` template sentinel → unshipped, still eligible.
//   - real `shipped_in: v<X.Y.Z>` stamp → never nudged.
//   - zero bound FRs (fresh / plan-only) → never flagged.
//   - `specs/plan/` absent or empty → vacuous.
//   - a plan that would otherwise be ship-ready and declares `spans_repos:`
//     is read through `spanningSiblingState`: any declared sibling not proved
//     `idle` holds it out of ship-ready (STE-609) — an unlocatable one on the
//     `sibling-unlocatable milestones:` row, every other held state on the
//     `awaiting-sibling milestones: <token> (<sibling>: <state>)` row. A
//     malformed declaration propagates its `SpansReposError` refusal.

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
// Union grammar: `M<N>` and `M_<epic-key>` active plans are both walked.
import { PLAN_FILENAME_RE, compareMilestoneTokens } from "./milestone_token";
import { normalizeFrontmatterSource } from "./frontmatter";
import { SpansReposError, resolveSpansRepos } from "./spans_repos";
import { readTaskTrackingSection } from "./resolver_config";
import { isToolkitManaged } from "./toolkit_managed";
import { parseWorktreePorcelain, runGit, sameRepository } from "./target_repo";
import { trackerIdsOf } from "./reconcile_tracker_local";
import { oneLine } from "./tracker_receipts";
import {
  type WorkspaceAdapterKey,
  type WorkspaceBinding,
  WorkspaceBindingError,
  readWorkspaceBinding,
} from "./workspace_binding";

export interface ActivePlanShipReadyReport {
  /** Always empty — the probe is warning-only by contract (NotesOnly). */
  violations: never[];
  notes: string[];
}

const STAMP_RE = /^v\d+\.\d+\.\d+$/;

/** Canonical remedy suffix on the ship-ready NOTES row. */
const NOTE_SUFFIX = " — run /spec-archive M<N> then /ship-milestone M<N>";

/** Scan the frontmatter block for a scalar key's trimmed value, or null. */
function scanFrontmatterField(content: string, key: string): string | null {
  // Fold BOM + CRLF/lone-CR first, or a Windows-authored file reads as
  // having no frontmatter and this check silently passes on an unparsed file.
  content = normalizeFrontmatterSource(content);
  if (!content.startsWith("---\n")) return null;
  const closeIdx = content.indexOf("\n---", 4);
  if (closeIdx < 0) return null;
  let value: string | null = null;
  for (const line of content.slice(4, closeIdx).split("\n")) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (m && m[1] === key) value = (m[2] ?? "").trim();
  }
  return value;
}

/** List `.md` files directly under `dir` (non-recursive); [] if absent. */
async function listMarkdownFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => join(dir, e.name))
      .sort();
  } catch {
    return [];
  }
}

/** One FR file: its id (filename stem) and the `milestone:` token it binds to. */
interface FrBindingRow {
  id: string;
  /** The trimmed `milestone:` value, or null when the key is absent. */
  milestone: string | null;
  /** The tracker keys its `tracker:` frontmatter binds (read by `readFrDir` only). */
  trackerIds?: string[];
}

/**
 * The ONE walk of an FR directory in this module. Both readings of the binding
 * — the token multiset the ship-ready predicate needs and the per-milestone id
 * lists `milestoneFrBinding` returns — are derived from these rows, so the
 * directory is scanned by one loop with one frontmatter reader rather than two
 * that could drift apart.
 */
async function readFrDir(dir: string): Promise<FrBindingRow[]> {
  const rows: FrBindingRow[] = [];
  for (const file of await listMarkdownFiles(dir)) {
    let content: string;
    try {
      content = await readFile(file, "utf-8");
    } catch {
      continue;
    }
    rows.push({
      id: basename(file, ".md"),
      milestone: scanFrontmatterField(content, "milestone"),
      trackerIds: trackerIdsOf(content),
    });
  }
  return rows;
}

/** The multiset of `milestone:` tokens these rows bind to (blanks dropped). */
function boundTokens(rows: readonly FrBindingRow[]): Set<string> {
  const tokens = new Set<string>();
  for (const row of rows) {
    if (row.milestone) tokens.add(row.milestone);
  }
  return tokens;
}

/** Ids among `rows` whose frontmatter binds them to `milestone`, sorted. */
function idsBoundTo(rows: readonly FrBindingRow[], milestone: string): string[] {
  return rows
    .filter((row) => row.milestone === milestone)
    .map((row) => row.id)
    .sort();
}

export interface Classification {
  shipReady: string[]; // sorted via compareMilestoneTokens
  parked: string[]; // sorted via compareMilestoneTokens
  /**
   * `<token> (<name>: <state>)` — a declared sibling is located but not idle
   * (STE-609: every state of the closed set but `idle` and `unlocatable`).
   */
  awaitingSiblings: string[]; // sorted via compareMilestoneTokens
  /** `<token> (<name> at <declaredPath>)` — a declared sibling cannot be located. */
  unlocatableSiblings: string[]; // sorted via compareMilestoneTokens
  /**
   * ADDITIVE (STE-609): `<token> (<name>: <state>)` for EVERY non-idle declared
   * sibling, unlocatable included — the milestones held out of ship-ready.
   */
  held: string[]; // sorted via compareMilestoneTokens
}

/**
 * The milestone token a rendered sibling entry leads with —
 * `M7 (glacy-app-be: busy)` → `M7`. The entry is rendered in this
 * module, so its parse lives here too rather than in each consumer.
 */
export function leadingToken(entry: string): string {
  return entry.split(" ", 1)[0]!;
}

/** Order rendered sibling entries by milestone token, not lexicographically. */
function byLeadingToken(a: string, b: string): number {
  return compareMilestoneTokens(leadingToken(a), leadingToken(b));
}

/** One declared sibling still holding active FRs bound to the milestone. */
export interface BusySibling {
  /** The sibling's declared `spans_repos:` name. */
  name: string;
  /** Ids of the sibling's active FRs bound to the milestone. */
  activeFrIds: string[];
  /** ADDITIVE (STE-609): each active id with every source that holds it. */
  activeFrs: SiblingActiveFr[];
}

// ---------------------------------------------------------------------------
// STE-609: the sibling is read from git, not from one working tree.
// ---------------------------------------------------------------------------

/** One active FR of a sibling, with every source that holds it active. */
export interface SiblingActiveFr {
  id: string;
  /** e.g. `worktree /abs/path`, `branch feature-x`, `remote-tracking origin/x`. */
  sources: string[];
}

/** What the git reader found for one sibling and one milestone. */
export interface SiblingFrRead {
  /** Active ids (held active somewhere, archived nowhere), sorted by id. */
  active: SiblingActiveFr[];
  /** Ids held under `specs/frs/archive/` bound to the milestone in any source, sorted. */
  archivedIds: string[];
  /**
   * Every copy of the milestone's plan (live or archived path) the sources
   * hold, in read order: each worktree's working tree first, then every ref.
   */
  plans: Array<{ source: string; body: string }>;
}

/**
 * A git command failed while reading a sibling. The caller reports the
 * sibling as `unreadable` — never as idle.
 */
export class SiblingReadError extends Error {
  constructor(
    readonly command: string,
    readonly detail: string,
  ) {
    super(`${command} failed: ${detail}`);
    this.name = "SiblingReadError";
  }
}

/** Refs per `git grep` invocation: a batch size, not a cap — every ref is read. */
const GIT_GREP_REF_BATCH = 100;

/**
 * Run git in `cwd` through the shared non-interactive runner (`runGit`: no
 * prompt, location variables scrubbed, a timeout — and never a fetch here).
 * Returns stdout as a Buffer; throws `SiblingReadError` on any failure.
 * `okStatuses` lists extra exit codes that are not a failure when stderr is
 * empty (git grep exits 1 on "no match").
 */
function siblingGit(
  cwd: string,
  args: readonly string[],
  opts: { input?: string; okStatuses?: readonly number[] } = {},
): Buffer {
  const command = `git ${args.join(" ")}`.slice(0, 200);
  const proc = runGit(cwd, args, { input: opts.input, timeoutMs: 30_000 });
  const stderr = oneLine(proc.stderr?.toString("utf-8") ?? "");
  if (proc.error) throw new SiblingReadError(command, oneLine(proc.error.message));
  if (proc.status === 0) return proc.stdout;
  if (proc.status !== null && opts.okStatuses?.includes(proc.status) && stderr === "") {
    return proc.stdout;
  }
  throw new SiblingReadError(
    command,
    stderr === "" ? `exit ${proc.status ?? `signal ${proc.signal}`}` : stderr,
  );
}

/** Collapse control characters so a detail stays on one refusal line. */

/** Is `root` (or an ancestor) marked as a git checkout? */
function hasGitMarker(root: string): boolean {
  let dir = resolve(root);
  for (;;) {
    if (existsSync(join(dir, ".git"))) return true;
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

/** Where an FR file sits relative to `specs/frs/`: its id and archive status, or null. */
function frPathKind(path: string): { id: string; archived: boolean } | null {
  const m = /^specs\/frs\/(archive\/)?([^/]+)\.md$/.exec(path);
  return m ? { id: m[2]!, archived: m[1] !== undefined } : null;
}

/** A human label for a ref: `branch <short>` or `remote-tracking <short>`. */
function refLabel(ref: string): string {
  if (ref.startsWith("refs/heads/")) return `branch ${ref.slice("refs/heads/".length)}`;
  if (ref.startsWith("refs/remotes/")) return `remote-tracking ${ref.slice("refs/remotes/".length)}`;
  return ref;
}

/**
 * Read a sibling's FRs bound to `milestone` from git (AC-STE-609.4): every
 * worktree's working tree (`git worktree list --porcelain`), every local
 * branch and every remote-tracking ref — without fetching. An id is active
 * when some source holds it under `specs/frs/` bound to the milestone and no
 * source holds it under `specs/frs/archive/` bound to it.
 *
 * A sibling outside any git checkout is read from its working tree alone (the
 * pre-STE-609 reading; whether such a sibling may release is a separate
 * question). Any git failure inside a checkout throws `SiblingReadError`.
 */
export async function readSiblingFrsFromGit(
  root: string,
  milestone: string,
): Promise<SiblingFrRead> {
  /** id → sources holding it active; ids archived anywhere. */
  const activeSources = new Map<string, Set<string>>();
  const archived = new Set<string>();
  const addRows = (rows: readonly FrBindingRow[], isArchived: boolean, source: string): void => {
    for (const id of idsBoundTo(rows, milestone)) {
      if (isArchived) archived.add(id);
      else {
        const set = activeSources.get(id) ?? new Set<string>();
        set.add(source);
        activeSources.set(id, set);
      }
    }
  };
  const plans: Array<{ source: string; body: string }> = [];
  // A sibling's working tree is read STRICTLY: an absent directory or plan is
  // "none there", but any other read failure (a permission error, a file that
  // vanished mid-read) is a SiblingReadError, so it classifies `unreadable`
  // and can never collapse into an empty, idle-looking read.
  const readWorkingTree = async (dir: string, source: string): Promise<void> => {
    const frsDir = join(dir, "specs", "frs");
    addRows(await readFrDirStrict(frsDir), false, source);
    addRows(await readFrDirStrict(join(frsDir, "archive")), true, source);
    for (const rel of planRelPaths(milestone)) {
      const body = await readFileStrict(join(dir, rel));
      if (body !== null) plans.push({ source, body });
    }
  };

  let inRepo = true;
  try {
    siblingGit(root, ["rev-parse", "--git-common-dir"]);
  } catch (error) {
    if (!(error instanceof SiblingReadError) || hasGitMarker(root)) throw error;
    inRepo = false;
  }
  if (!inRepo) {
    await readWorkingTree(root, `working tree ${root}`);
  } else {
    // Leg 1: every worktree's working tree (uncommitted work included).
    const worktrees = parseWorktreePorcelain(
      siblingGit(root, ["worktree", "list", "--porcelain"]).toString("utf-8"),
    )
      .filter((entry) => !entry.bare)
      .map((entry) => entry.path);
    for (const wt of worktrees) await readWorkingTree(wt, `worktree ${wt}`);

    // Leg 2: every local branch and remote-tracking ref, one `git grep` per
    // batch of refs for the token, then a frontmatter read of each hit.
    const refs = siblingGit(root, [
      "for-each-ref",
      "--format=%(refname)",
      "refs/heads",
      "refs/remotes",
    ])
      .toString("utf-8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.endsWith("/HEAD"));
    const hits: Array<{ ref: string; path: string }> = [];
    for (let i = 0; i < refs.length; i += GIT_GREP_REF_BATCH) {
      const batch = refs.slice(i, i + GIT_GREP_REF_BATCH);
      const out = siblingGit(
        root,
        ["grep", "-l", "-I", "-F", "--no-color", "-e", milestone, ...batch, "--", "specs/frs", "specs/plan"],
        { okStatuses: [1] },
      ).toString("utf-8");
      for (const line of out.split("\n")) {
        if (line === "") continue;
        // Ref names cannot contain `:`, so the first one splits ref from path.
        const at = line.indexOf(":");
        if (at < 0) continue;
        const ref = line.slice(0, at);
        const path = line.slice(at + 1);
        if (frPathKind(path) !== null || planRelPaths(milestone).includes(path)) hits.push({ ref, path });
      }
    }
    if (hits.length > 0) {
      const blobs = catFileBatch(root, hits.map((h) => `${h.ref}:${h.path}`));
      hits.forEach((hit, i) => {
        const kind = frPathKind(hit.path);
        if (kind === null) {
          plans.push({ source: refLabel(hit.ref), body: blobs[i]! });
          return;
        }
        const bound = scanFrontmatterField(blobs[i]!, "milestone") === milestone;
        if (bound) addRows([{ id: kind.id, milestone }], kind.archived, refLabel(hit.ref));
      });
    }
  }

  const active = [...activeSources.entries()]
    .filter(([id]) => !archived.has(id))
    .map(([id, sources]) => ({ id, sources: [...sources] }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { active, archivedIds: [...archived].sort(), plans };
}

/** One active spec file the git state holds: where it is live, and one copy of its text. */
export interface ActiveSpec {
  /** The plan token or the FR id (the file name without `.md`). */
  name: string;
  /** Every source holding it live, e.g. `worktree /abs/path`, `branch feat/x`, `remote-tracking origin/x`. */
  sources: string[];
  /** Its text as the first source listed holds it. */
  body: string;
}

/** Every active plan and FR a repository's git state holds (M_685ff6 review). */
export interface ActiveSpecsRead {
  plans: ActiveSpec[];
  frs: ActiveSpec[];
}

/**
 * Every active plan and FR in `root`'s git state — every worktree's working
 * tree, every local branch and every remote-tracking ref, never a fetch — by
 * the rule `readSiblingFrsFromGit` grades one milestone with: a file is
 * active when some source holds it at its live path (`specs/plan/<token>.md`,
 * `specs/frs/<id>.md`) without `status: archived`, and no source holds it
 * archived (under `archive/`, or at the live path with `status: archived`).
 * A repository outside any git checkout is read from its working tree alone.
 * Any git or read failure throws `SiblingReadError` — never an empty read.
 */
export async function readActiveSpecsFromGit(root: string): Promise<ActiveSpecsRead> {
  const live = { plans: new Map<string, ActiveSpec>(), frs: new Map<string, ActiveSpec>() };
  const archived = { plans: new Set<string>(), frs: new Set<string>() };
  const note = (kind: "plans" | "frs", name: string, body: string, source: string): void => {
    if (scanFrontmatterField(body, "status") === "archived") {
      archived[kind].add(name);
      return;
    }
    const seen = live[kind].get(name);
    if (seen) seen.sources.push(source);
    else live[kind].set(name, { name, sources: [source], body });
  };
  const isPlanName = (file: string): boolean => PLAN_FILENAME_RE.test(file);

  const readWorkingTree = async (dir: string, source: string): Promise<void> => {
    for (const [kind, rel] of [
      ["frs", join("specs", "frs")],
      ["plans", join("specs", "plan")],
    ] as const) {
      const liveDir = join(dir, rel);
      for (const name of await listMarkdownFilesStrict(liveDir)) {
        if (kind === "plans" && !isPlanName(name)) continue;
        const body = await readFileStrict(join(liveDir, name));
        if (body === null) throw new SiblingReadError(`read ${join(liveDir, name)}`, "vanished while being read");
        note(kind, basename(name, ".md"), body, source);
      }
      for (const name of await listMarkdownFilesStrict(join(liveDir, "archive"))) {
        archived[kind].add(basename(name, ".md"));
      }
    }
  };

  let inRepo = true;
  try {
    siblingGit(root, ["rev-parse", "--git-common-dir"]);
  } catch (error) {
    if (!(error instanceof SiblingReadError) || hasGitMarker(root)) throw error;
    inRepo = false;
  }
  if (!inRepo) {
    await readWorkingTree(root, `working tree ${root}`);
  } else {
    const worktrees = parseWorktreePorcelain(siblingGit(root, ["worktree", "list", "--porcelain"]).toString("utf-8"))
      .filter((entry) => !entry.bare)
      .map((entry) => entry.path);
    for (const wt of worktrees) await readWorkingTree(wt, `worktree ${wt}`);

    const refs = siblingGit(root, ["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"])
      .toString("utf-8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "" && !l.endsWith("/HEAD"));
    const pending: Array<{ kind: "plans" | "frs"; name: string; ref: string; path: string }> = [];
    for (const ref of refs) {
      const paths = siblingGit(root, ["ls-tree", "-r", "--name-only", ref, "--", "specs/frs", "specs/plan"])
        .toString("utf-8")
        .split("\n")
        .filter((l) => l !== "");
      for (const path of paths) {
        const m = /^specs\/(frs|plan)\/(archive\/)?([^/]+\.md)$/.exec(path);
        if (!m) continue;
        const kind = m[1] === "frs" ? "frs" : "plans";
        if (kind === "plans" && !isPlanName(m[3]!)) continue;
        const name = basename(m[3]!, ".md");
        if (m[2] !== undefined) archived[kind].add(name);
        else pending.push({ kind, name, ref, path });
      }
    }
    if (pending.length > 0) {
      const blobs = catFileBatch(root, pending.map((p) => `${p.ref}:${p.path}`));
      pending.forEach((p, i) => note(p.kind, p.name, blobs[i]!, refLabel(p.ref)));
    }
  }

  const active = (kind: "plans" | "frs"): ActiveSpec[] =>
    [...live[kind].values()]
      .filter((x) => !archived[kind].has(x.name))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { plans: active("plans"), frs: active("frs") };
}

/** `.md` file names directly under `dir`, sorted; absent is empty, any other failure throws. */
async function listMarkdownFilesStrict(dir: string): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isAbsent(error)) return [];
    throw new SiblingReadError(`list ${dir}`, errorCode(error));
  }
  return entries.filter((e) => e.isFile() && e.name.endsWith(".md")).map((e) => e.name).sort();
}

/** The two repo-relative paths a plan for `milestone` can live at: live, then archived. */
export function planRelPaths(milestone: string): string[] {
  return [`specs/plan/${milestone}.md`, `specs/plan/archive/${milestone}.md`];
}

/** A file's text, null when it does not exist; any other failure is a SiblingReadError. */
async function readFileStrict(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf-8");
  } catch (error) {
    if (isAbsent(error)) return null;
    throw new SiblingReadError(`read ${file}`, errorCode(error));
  }
}

/** `readFrDir` for a sibling: an absent directory is empty, any other failure throws. */
async function readFrDirStrict(dir: string): Promise<FrBindingRow[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isAbsent(error)) return [];
    throw new SiblingReadError(`list ${dir}`, errorCode(error));
  }
  const rows: FrBindingRow[] = [];
  for (const e of entries.filter((x) => x.isFile() && x.name.endsWith(".md")).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const content = await readFileStrict(join(dir, e.name));
    if (content === null) throw new SiblingReadError(`read ${join(dir, e.name)}`, "vanished while being read");
    rows.push({ id: basename(e.name, ".md"), milestone: scanFrontmatterField(content, "milestone") });
  }
  return rows;
}

function isAbsent(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : error instanceof Error ? error.message : String(error);
}

/** Read each `<rev>:<path>` object's content with one `git cat-file --batch`. */
function catFileBatch(root: string, specs: readonly string[]): string[] {
  const out = siblingGit(root, ["cat-file", "--batch"], { input: `${specs.join("\n")}\n` });
  const contents: string[] = [];
  let pos = 0;
  for (const spec of specs) {
    const nl = out.indexOf(0x0a, pos);
    if (nl < 0) throw new SiblingReadError("git cat-file --batch", `truncated output at ${spec}`);
    const header = out.subarray(pos, nl).toString("utf-8");
    const m = /^\S+ (\S+) (\d+)$/.exec(header);
    if (!m || m[1] !== "blob") {
      throw new SiblingReadError("git cat-file --batch", `${spec}: ${oneLine(header)}`);
    }
    const size = Number(m[2]);
    contents.push(out.subarray(nl + 1, nl + 1 + size).toString("utf-8"));
    pos = nl + 1 + size + 1; // the content is followed by one LF
  }
  return contents;
}

/** A spanning milestone's declared siblings, rendered once for every consumer. */
export interface SpanningSiblingState {
  /** `<token> (<name>: <n> active FRs)` — a declared sibling still holds work. */
  busy: string[];
  /**
   * ADDITIVE (STE-589): the same busy siblings as `busy`, structured, with
   * their active FR ids — from the SAME resolution, so a consumer that names
   * the ids never walks a second time.
   */
  busySiblings: BusySibling[];
  /** `<token> (<name> at <declaredPath>)` — a declared sibling cannot be located. */
  unlocatable: string[];
  /**
   * ADDITIVE (STE-609): `<token> (<name>: unreadable)` — a git read of the
   * sibling failed, so it cannot be proved idle.
   */
  unreadable: string[];
  /**
   * ADDITIVE (STE-589): every non-self declared sibling, in declaration order,
   * from the SAME resolution — `root` is `null` when it cannot be located.
   */
  siblings: DeclaredSibling[];
}

/** One declared non-self sibling, as resolved. */
export interface DeclaredSibling {
  /** The sibling's declared `spans_repos:` name. */
  name: string;
  /** The path exactly as the declaration wrote it. */
  declaredPath: string;
  /** Absolute root of the sibling, or `null` when it cannot be located. */
  root: string | null;
  /** ADDITIVE (STE-609): the sibling's state, from the one classification. */
  state: SiblingStateName;
  /** ADDITIVE (STE-609): why an `unreadable` sibling is unreadable; absent otherwise. */
  reason?: string;
}

/**
 * The closed sibling-state set (STE-609). A located sibling is `idle` only
 * when it is a git repository, is toolkit-managed, binds the same tracker
 * project as this repository (tracker modes), holds a plan for the milestone
 * whose `spans_repos:` names this repository back (else `one-sided`, STE-610),
 * has at least one FR bound to the milestone, and has no active one.
 */
export type SiblingStateName =
  | "idle"
  | "busy"
  | "not-started"
  | "no-plan"
  | "unlocatable"
  | "not-a-repository"
  | "not-toolkit-managed"
  | "different-container"
  | "unreadable"
  | "one-sided";

/** The tracker adapter key `root`'s CLAUDE.md declares, or null (mode none / absent). */
export function trackerAdapterKey(root: string): WorkspaceAdapterKey | null {
  const mode = readTaskTrackingSection(join(root, "CLAUDE.md")).mode;
  return mode === "linear" || mode === "jira" ? mode : null;
}

/** First line of a (possibly multi-line NFR-10) message, collapsed. */
function firstLine(text: string): string {
  return oneLine(text.split("\n", 1)[0] ?? "");
}

/**
 * The container facts of a located sibling, before its FRs are read:
 * `not-a-repository`, `not-toolkit-managed`, `unreadable` (a declaration the
 * workspace-binding reader refuses) or `different-container`; `null` when none
 * applies. `different-container` is decided by `readWorkspaceBinding` on both
 * roots and does not apply when this repository runs `mode: none`.
 */
function siblingContainerState(
  projectRoot: string,
  root: string,
): { state: SiblingStateName; reason?: string } | null {
  try {
    siblingGit(root, ["rev-parse", "--git-common-dir"]);
  } catch (error) {
    if (!(error instanceof SiblingReadError)) throw error;
    if (!hasGitMarker(root)) return { state: "not-a-repository" };
    return { state: "unreadable", reason: error.message };
  }
  if (!isToolkitManaged(root)) return { state: "not-toolkit-managed" };
  const adapter = trackerAdapterKey(projectRoot);
  if (adapter === null) return null;
  let own: WorkspaceBinding;
  try {
    own = readWorkspaceBinding(join(projectRoot, "CLAUDE.md"), adapter);
  } catch (error) {
    if (!(error instanceof WorkspaceBindingError)) throw error;
    return { state: "unreadable", reason: `this repository's declaration: ${firstLine(error.message)}` };
  }
  let theirs: WorkspaceBinding;
  try {
    theirs = readWorkspaceBinding(join(root, "CLAUDE.md"), adapter);
  } catch (error) {
    if (!(error instanceof WorkspaceBindingError)) throw error;
    return { state: "unreadable", reason: firstLine(error.message) };
  }
  if (trackerAdapterKey(root) !== adapter || (theirs.project ?? "") !== (own.project ?? "")) {
    return {
      state: "different-container",
      reason: `bound to ${trackerAdapterKey(root) ?? "no tracker"} project "${theirs.project ?? ""}", this repository to ${adapter} project "${own.project ?? ""}"`,
    };
  }
  return null;
}

/**
 * THE sibling predicate: the one classification of each of `milestone`'s
 * declared `spans_repos:` siblings into the closed `SiblingStateName` set
 * (STE-609) — located or not, a git repository, toolkit-managed, in the same
 * tracker container, then its FRs read from git (every worktree, local branch
 * and remote-tracking ref), its plan naming this repository back (STE-610).
 * Every consumer — `classifyActivePlans`, both resume
 * scopes, refusal #4 — reads `siblings[].state` from here and never
 * re-derives it; `busy`, `unlocatable` and `unreadable` are renderings of the
 * same pass. An undeclared plan resolves to empty lists; a malformed
 * declaration throws `SpansReposError`, exactly as `resolveSpansRepos` does.
 */
export async function spanningSiblingState(
  projectRoot: string,
  planBody: string,
  milestone: string,
): Promise<SpanningSiblingState> {
  const resolved = (
    await resolveSpansRepos({ planBody, milestone, invokingRepo: projectRoot })
  ).filter((s) => !s.self);
  const siblings: DeclaredSibling[] = [];
  const busySiblings: BusySibling[] = [];
  for (const { name, declaredPath, root } of resolved) {
    if (root === null) {
      siblings.push({ name, declaredPath, root, state: "unlocatable" });
      continue;
    }
    const container = siblingContainerState(projectRoot, root);
    if (container !== null) {
      siblings.push({ name, declaredPath, root, ...container });
      continue;
    }
    // The sibling is read from git — every worktree, local branch and
    // remote-tracking ref (STE-609) — never from one working tree alone.
    let read: SiblingFrRead;
    try {
      read = await readSiblingFrsFromGit(root, milestone);
    } catch (error) {
      if (!(error instanceof SiblingReadError)) throw error;
      siblings.push({ name, declaredPath, root, state: "unreadable", reason: error.message });
      continue;
    }
    if (read.active.length > 0) {
      busySiblings.push({
        name,
        activeFrIds: read.active.map((fr) => fr.id),
        activeFrs: read.active,
      });
      siblings.push({ name, declaredPath, root, state: "busy" });
      continue;
    }
    // The plan is read from every source too — any worktree, local branch or
    // remote-tracking ref — so a plan held only off the located checkout is
    // still a plan (STE-609).
    if (read.plans.length === 0) {
      siblings.push({ name, declaredPath, root, state: "no-plan" });
      continue;
    }
    // The sibling's OWN declaration must resolve from its own root: a
    // declaration pasted verbatim reads every entry as self there, so the other
    // half could never be graded. Classified here, once, so every surface —
    // refusal #4, probe #75, the close offer, both resume scopes — holds it.
    const own = read.plans.find((p) => p.source === `worktree ${root}`) ?? read.plans[0]!;
    let back: Awaited<ReturnType<typeof resolveSpansRepos>>;
    try {
      back = await resolveSpansRepos({ planBody: own.body, milestone, invokingRepo: root });
    } catch (error) {
      if (!(error instanceof SpansReposError)) throw error;
      siblings.push({
        name,
        declaredPath,
        root,
        state: "unreadable",
        reason: `its own spans_repos: (${own.source}) refuses — ${firstLine(error.message)}`,
      });
      continue;
    }
    // STE-610: the sibling's plan must name THIS repository back — a plan with
    // no `spans_repos:` (resolving to no entries) is one-sided too.
    if (!back.some((s) => s.root !== null && sameRepository(s.root, projectRoot))) {
      siblings.push({ name, declaredPath, root, state: "one-sided" });
      continue;
    }
    if (read.archivedIds.length === 0) {
      siblings.push({ name, declaredPath, root, state: "not-started" });
      continue;
    }
    siblings.push({ name, declaredPath, root, state: "idle" });
  }
  return {
    busy: busySiblings.map((s) => `${milestone} (${s.name}: ${s.activeFrIds.length} active FRs)`),
    busySiblings,
    unlocatable: siblings
      .filter((s) => s.state === "unlocatable")
      .map((s) => `${milestone} (${s.name} at ${s.declaredPath})`),
    unreadable: heldSiblings(
      milestone,
      siblings.filter((s) => s.state === "unreadable"),
    ),
    siblings,
  };
}

/**
 * THE held rendering (STE-609): `<token> (<name>: <state>)` for every declared
 * sibling whose state — read from `spanningSiblingState(...).siblings[].state`,
 * never re-derived — is not `idle`. Every surface that holds a spanning
 * milestone (probe #75, the close-offer CLI, both resume scopes) renders
 * through this one function.
 */
export function heldSiblings(milestone: string, siblings: readonly DeclaredSibling[]): string[] {
  return siblings
    .filter((s) => s.state !== "idle")
    .map((s) => `${milestone} (${oneLine(s.name)}: ${s.state})`);
}

/** Walk active plans and classify each one; shared core of every export. */
export async function classifyActivePlans(projectRoot: string): Promise<Classification> {
  const planDir = join(projectRoot, "specs", "plan");
  const planFiles = (await listMarkdownFiles(planDir)).filter((f) =>
    PLAN_FILENAME_RE.test(basename(f)),
  );
  const out: Classification = {
    shipReady: [],
    parked: [],
    awaitingSiblings: [],
    unlocatableSiblings: [],
    held: [],
  };
  if (planFiles.length === 0) return out;

  const frsDir = join(projectRoot, "specs", "frs");
  const activeFrTokens = boundTokens(await readFrDir(frsDir));
  const archivedFrTokens = boundTokens(await readFrDir(join(frsDir, "archive")));

  for (const file of planFiles) {
    let content: string;
    try {
      content = await readFile(file, "utf-8");
    } catch {
      continue;
    }
    const token = basename(file, ".md");
    // Real `shipped_in: v<X.Y.Z>` stamp → already shipped, never nudged.
    // (`shipped_in: null` is the plan template's pre-ship sentinel: unshipped.)
    const shippedIn = scanFrontmatterField(content, "shipped_in");
    if (shippedIn !== null && STAMP_RE.test(shippedIn)) continue;
    // Parked plans are excluded from the predicate (no /gate-check nudge, no
    // /implement close offer) but surfaced so parking never goes silent.
    if (scanFrontmatterField(content, "ship_state") === "parked") {
      out.parked.push(token);
      continue;
    }
    // Ship-ready ⇔ zero active FRs bound AND ≥ 1 archived FR bound.
    if (!activeFrTokens.has(token) && archivedFrTokens.has(token)) {
      // A spanning milestone waits for every declared sibling: any sibling
      // not proved `idle` holds it out of ship-ready (STE-609). An unlocatable
      // one keeps its own row; every other held state renders awaiting-sibling.
      // Undeclared plans resolve to [].
      const { siblings, unlocatable } = await spanningSiblingState(projectRoot, content, token);
      const held = heldSiblings(token, siblings);
      if (held.length > 0) {
        out.held.push(...held);
        out.awaitingSiblings.push(
          ...heldSiblings(
            token,
            siblings.filter((s) => s.state !== "unlocatable"),
          ),
        );
        out.unlocatableSiblings.push(...unlocatable);
        continue;
      }
      out.shipReady.push(token);
    }
  }

  out.shipReady.sort(compareMilestoneTokens);
  out.parked.sort(compareMilestoneTokens);
  out.awaitingSiblings.sort(byLeadingToken);
  out.unlocatableSiblings.sort(byLeadingToken);
  out.held.sort(byLeadingToken);
  return out;
}

/**
 * Shared predicate: bare milestone tokens of every active plan that is
 * ship-ready (zero active FRs, ≥ 1 archived FR, not parked, not stamped, and
 * every declared `spans_repos:` sibling proved `idle`), sorted via
 * compareMilestoneTokens.
 *
 * Call sites: `/gate-check` probe #75 (via runActivePlanShipReadyProbe) and
 * the `/implement` FR-form close offer — ONE predicate, two consumers.
 */
export async function shipReadyMilestones(projectRoot: string): Promise<string[]> {
  return (await classifyActivePlans(projectRoot)).shipReady;
}

/** FR ids bound to one milestone, split by archive status. */
export interface MilestoneFrBinding {
  /** Ids of FRs under `specs/frs/` carrying this milestone token. */
  activeFrIds: string[];
  /** Ids of FRs under `specs/frs/archive/` carrying this milestone token. */
  archivedFrIds: string[];
}

/**
 * ADDITIVE (STE-498): the milestone-scoped view of the SAME active/archived FR
 * binding this module's ship-ready predicate is derived from.
 *
 * `shipReadyMilestones` answers a yes/no; a consumer that also needs to tell
 * "nothing built yet" from "some FRs already landed and archived" would
 * otherwise walk the FR directories itself and become a second source of truth
 * for the binding. It calls this instead. Pure reads; the probe and the
 * ship-ready predicate are untouched.
 */
export async function milestoneFrBinding(
  projectRoot: string,
  milestone: string,
): Promise<MilestoneFrBinding> {
  const frsDir = join(projectRoot, "specs", "frs");
  return {
    activeFrIds: idsBoundTo(await readFrDir(frsDir), milestone),
    archivedFrIds: idsBoundTo(await readFrDir(join(frsDir, "archive")), milestone),
  };
}

/**
 * STE-610: the tracker keys this repository's active and archived FR files
 * bound to `milestone` carry — read from the same one walk as
 * `milestoneFrBinding`, sorted and de-duplicated.
 */
export async function milestoneTrackerKeys(projectRoot: string, milestone: string): Promise<string[]> {
  const frsDir = join(projectRoot, "specs", "frs");
  const rows = [...(await readFrDir(frsDir)), ...(await readFrDir(join(frsDir, "archive")))];
  return [...new Set(rows.filter((r) => r.milestone === milestone).flatMap((r) => r.trackerIds ?? []))].sort();
}

/**
 * Warning-only probe report: `violations` is always empty; ship-ready hits
 * render a single comma-separated NOTES row plus the parked-milestones row.
 * Pure function — no side effects, no writes.
 *
 * Call site: `/gate-check` probe #75 + the STE-462 integration test at
 * `tests/gate-check-active-plan-ship-ready.test.ts`.
 */
export async function runActivePlanShipReadyProbe(
  projectRoot: string,
): Promise<ActivePlanShipReadyReport> {
  const { shipReady, parked, awaitingSiblings, unlocatableSiblings } =
    await classifyActivePlans(projectRoot);
  const notes: string[] = [];
  if (shipReady.length > 0) {
    notes.push(`ship-ready milestones: ${shipReady.join(", ")}${NOTE_SUFFIX}`);
  }
  if (parked.length > 0) {
    notes.push(`parked milestones: ${parked.join(", ")}`);
  }
  if (awaitingSiblings.length > 0) {
    notes.push(`awaiting-sibling milestones: ${awaitingSiblings.join(", ")}`);
  }
  if (unlocatableSiblings.length > 0) {
    notes.push(`sibling-unlocatable milestones: ${unlocatableSiblings.join(", ")}`);
  }
  return { violations: [], notes };
}

// Read-only CLI mirroring `upgrade_staleness.ts`: `/implement`'s ship-ready
// close offer runs the shared predicate through this entrypoint instead of
// re-deriving the classification in prose. Imported by tests,
// `import.meta.main` is false and this block never runs — keeping the module
// free of side effects at import. Prints one ship-ready milestone per line;
// empty stdout means none. Each held spanning milestone (STE-609) prints one
// `held: <token> (<sibling>: <state>)` line on stderr — exit 0, stdout untouched.
if (import.meta.main) {
  const projectRoot = process.argv[2] ?? process.cwd();
  try {
    const { shipReady, held } = await classifyActivePlans(projectRoot);
    if (shipReady.length > 0) console.log(shipReady.join("\n"));
    for (const entry of held) console.error(`held: ${entry}`);
  } catch (e) {
    // A malformed `spans_repos:` on an otherwise ship-ready plan is a refusal,
    // not a crash: its NFR-10 message goes to stderr and stdout stays EMPTY,
    // so the /implement close offer's "empty stdout = none" reading holds.
    if (!(e instanceof SpansReposError)) throw e;
    console.error(e.message);
    process.exitCode = 1;
  }
}

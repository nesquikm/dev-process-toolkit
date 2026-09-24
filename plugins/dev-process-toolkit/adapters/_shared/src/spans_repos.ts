// A milestone plan's `spans_repos:` declaration — the repositories one
// milestone's work lives in.
//
// The key is read ONLY through the shared frontmatter parser, which already
// normalizes CRLF / lone-CR / BOM and reads a nested map at 2-space, 4-space
// and tab indentation. No line scan of our own: a second reader of the same
// block would be a second home for the same fact.
//
// STE-610 adds the one WRITER of the key: `declareSpan` (front door
// `--declare`) verifies a sibling (`verifySpan`) and inserts the two-entry
// block into both plans' frontmatter. The checks read every existing
// declaration back through the reader above before anything is written; the
// insert itself only adds lines before the closing fence, keeping every other
// byte. A hand-written declaration is still read exactly the same way.

import { readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
// The import cycle with active_plan_ship_ready.ts predates STE-610 (it already
// imports `resolveSpansRepos` from here); every name crossing it is a function
// called at run time, never at module evaluation, so the cycle is inert.
import {
  milestoneFrBinding,
  planRelPaths,
  readSiblingFrsFromGit,
  SiblingReadError,
} from "./active_plan_ship_ready";
import { joinFrontmatter, parseFrontmatter, splitFrontmatter } from "./frontmatter";
import { readTaskTrackingSection } from "./resolver_config";
import { isToolkitManaged } from "./toolkit_managed";
import {
  readWorkspaceBinding,
  WorkspaceBindingError,
  type WorkspaceBinding,
} from "./workspace_binding";
import {
  defaultRepoProbe,
  isUndeclaredScalar,
  mainWorktreeRoot,
  sameRepository,
  type RepoProbe,
} from "./target_repo";
import { oneLine } from "./tracker_receipts";

/** The plan frontmatter key this module reads. */
export const SPANS_REPOS_KEY = "spans_repos";

/** One declared repository: its name and the path exactly as written. */
export interface SpansReposEntry {
  readonly name: string;
  readonly declaredPath: string;
}

export type SpansReposDeclaration =
  | { readonly declared: true; readonly entries: readonly SpansReposEntry[] }
  | { readonly declared: false; readonly entries: null };

/** A malformed `spans_repos:` declaration. */
export class SpansReposError extends Error {
  override readonly name = "SpansReposError";
}

/** NFR-10 three-line refusal: this helper owns the shape, callers own the words. */
function nfr10Refusal(refusing: string, remedy: string, context: string): string {
  return [`Refusing: ${refusing}`, `Remedy: ${remedy}`, `Context: ${context}`].join(
    "\n",
  );
}

/** The remedy every not-a-map spelling shares. */
const MAP_SHAPE_REMEDY =
  "spans_repos takes a nested map of repo name to path — one `name: path` line per repo, indented under the key";

/** The work a sibling repo holds that is bound to the milestone. */
export interface SiblingBinding {
  readonly activeFrIds: readonly string[];
  readonly archivedFrIds: readonly string[];
}

/** One declared entry, resolved against the filesystem. */
export interface SiblingState {
  readonly name: string;
  readonly declaredPath: string;
  /** Absolute root of the repo, or `null` when it cannot be located. */
  readonly root: string | null;
  /** True when this entry names the invoking repo. */
  readonly self: boolean;
  readonly binding: SiblingBinding | null;
}

export interface ResolveSpansReposInput {
  readonly planBody: string;
  readonly milestone: string;
  readonly invokingRepo: string;
  readonly probe?: RepoProbe;
}

/**
 * Read a milestone plan's `spans_repos:` declaration, entries in the order
 * the parser read them (which is the order they were written).
 */
export function readSpansReposDeclaration(planBody: string): SpansReposDeclaration {
  const fm = parseFrontmatter(planBody, { lenient: true });
  const raw = fm[SPANS_REPOS_KEY];
  // Absent and null are undeclared — tested before any typeof check, since
  // typeof null === "object".
  if (raw === undefined || raw === null) {
    return { declared: false, entries: null };
  }
  if (typeof raw === "string") {
    const value = raw.trim();
    if (isUndeclaredScalar(value)) {
      return { declared: false, entries: null };
    }
    // A flow list (and a comma string) arrives from the parser as a STRING.
    throw new SpansReposError(
      nfr10Refusal(
        `spans_repos is written as the single value \`${value}\`, not a map.`,
        `${MAP_SHAPE_REMEDY}.`,
        "spans_repos=string, phase=spans-repos-read",
      ),
    );
  }
  // A block list, `spans_repos: {}` and a bare `spans_repos:` all arrive from
  // the parser as the same `{}` — the spelling is gone before this line, so
  // the message names all three causes, asserts none, and interpolates nothing.
  if (
    typeof raw === "object" &&
    raw !== null &&
    !Array.isArray(raw) &&
    Object.keys(raw).length === 0
  ) {
    throw new SpansReposError(
      nfr10Refusal(
        "spans_repos is declared but holds no repo entries — it is written as a block list (`- name` items), as an empty map `{}`, or as a bare `spans_repos:` key with nothing under it.",
        `${MAP_SHAPE_REMEDY}; or delete the key if the milestone lives in one repo.`,
        "spans_repos=empty-map, phase=spans-repos-read",
      ),
    );
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const pairs = Object.entries(raw as Record<string, unknown>);
    // A block list whose items carry colons (`- name: path`) survives the
    // parser with its `- ` intact in each key, so this spelling — unlike the
    // colon-less block list — can be named exactly.
    // A bare `-` key is the same list item with nothing after the dash.
    const listKeys = pairs
      .map(([k]) => k.trim())
      .filter((k) => k === "-" || k.startsWith("- "));
    if (listKeys.length > 0) {
      throw new SpansReposError(
        nfr10Refusal(
          `spans_repos is written as a block list — ${listKeys.map((k) => `\`${k}\``).join(", ")} — and a leading \`- \` makes each line a list item rather than a repo name.`,
          "drop the leading `- ` so each line under spans_repos is `name: path`, indented under the key.",
          "spans_repos=block-list-items, phase=spans-repos-read",
        ),
      );
    }
    // Every value must be a non-empty string path. The parser gives `""` for
    // an empty value, JS null for `null`, and may give a boolean or number —
    // refuse the first offender, naming its key verbatim.
    // An undeclared sentinel is no path either: `~` would expand to the home
    // directory and resolve a real — and wrong — sibling.
    const offender = pairs.find(([, v]) => typeof v !== "string" || isUndeclaredScalar(v));
    if (offender !== undefined) {
      const [key, v] = offender;
      const valueKind =
        v === null
          ? "null"
          : typeof v === "string"
            ? v.trim() === ""
              ? "empty"
              : v.trim()
            : typeof v;
      throw new SpansReposError(
        nfr10Refusal(
          `spans_repos entry \`${key}\` has no path — its value is ${valueKind === "empty" ? "empty" : `\`${valueKind}\``}, and every entry must map a repo name to a path.`,
          `write the path after the colon — \`${key}: <path>\` — using \`.\` for the invoking repo; or delete the \`${key}\` line if the milestone does not span it.`,
          `spans_repos_entry=${key}, value=${valueKind}, phase=spans-repos-read`,
        ),
      );
    }
    return {
      declared: true,
      entries: pairs.map(([name, v]) => ({ name, declaredPath: v as string })),
    };
  }
  // Anything else — a boolean, a number, a list — is not a map of repo names.
  const kind = Array.isArray(raw) ? "list" : typeof raw;
  throw new SpansReposError(
    nfr10Refusal(
      `spans_repos is written as a ${kind} value, not a map.`,
      `${MAP_SHAPE_REMEDY}.`,
      `spans_repos=${kind}, phase=spans-repos-read`,
    ),
  );
}

/**
 * Resolve every declared entry to a root, self flag and binding, one state per
 * entry in declaration order. An undeclared plan resolves to `[]`.
 *
 * Locating defers to the shared repo probe, same-repo to `sameRepository`, and the
 * binding to `milestoneFrBinding` — each fact keeps its one home. The self
 * entry and an unlocatable entry carry no binding.
 */
export async function resolveSpansRepos(
  input: ResolveSpansReposInput,
): Promise<SiblingState[]> {
  const { planBody, milestone, invokingRepo } = input;
  const declaration = readSpansReposDeclaration(planBody);
  if (!declaration.declared) return [];
  // A relative path resolves against the MAIN worktree root, so every
  // checkout of the repository — a nested `.claude/worktrees/<name>` one
  // included — locates the same sibling (STE-609). No main worktree (a bare
  // common directory, no git) falls back to the invoking checkout.
  const probe =
    input.probe ?? defaultRepoProbe(mainWorktreeRoot(invokingRepo) ?? invokingRepo);
  const located = declaration.entries.map(({ name, declaredPath }) => {
    const root = probe.locate(declaredPath);
    const self = root !== null && sameRepository(root, invokingRepo);
    return { name, declaredPath, root, self };
  });
  // Exactly one entry names the invoking repository (STE-609). Zero leaves
  // the declaration with no home; two or more — a declaration pasted verbatim
  // into the sibling — reads every entry as self and would ship with an empty
  // sibling footer. Refused here so every reader refuses alike.
  const selfCount = located.filter((s) => s.self).length;
  if (selfCount !== 1) {
    throw new SpansReposError(selfCountRefusal(located, selfCount, invokingRepo));
  }
  const states: SiblingState[] = [];
  for (const { name, declaredPath, root, self } of located) {
    const binding =
      root !== null && !self ? await milestoneFrBinding(root, milestone) : null;
    states.push({ name, declaredPath, root, self, binding });
  }
  return states;
}

/** The refusal for a declaration with zero, or two or more, self entries. */
function selfCountRefusal(
  located: ReadonlyArray<{ name: string; declaredPath: string; root: string | null; self: boolean }>,
  selfCount: number,
  invokingRepo: string,
): string {
  const each = located
    .map(
      (s) =>
        `\`${oneLine(s.name)}: ${oneLine(s.declaredPath)}\` resolved to ${s.root === null ? "no repository (unlocatable)" : `\`${oneLine(s.root)}\``}${s.self ? " (the invoking repository)" : ""}`,
    )
    .join("; ");
  const what =
    selfCount === 0
      ? "no spans_repos entry names the invoking repository"
      : `${selfCount} spans_repos entries name the invoking repository`;
  return nfr10Refusal(
    `${what} \`${oneLine(invokingRepo)}\` — exactly one must. ${each}.`,
    "keep exactly one entry that resolves to this repository (`.` names it) and point every other entry at its sibling; a declaration copied from a sibling needs its paths rewritten relative to this repository.",
    `spans_repos_self_entries=${selfCount}, entries=${located.length}, phase=spans-repos-resolve`,
  );
}

// ---------------------------------------------------------------------------
// STE-610: declaring the span in both plans.
// ---------------------------------------------------------------------------

export interface DeclareSpanInput {
  /** The invoking checkout (a primary checkout or any worktree of it). */
  readonly invokingRepo: string;
  /**
   * The invoking repository's plan file for the milestone. A join's dry run
   * (AC-STE-610.4) runs before this side's plan is written, so it may pass
   * `null`: there is no invoking plan to grade yet, and none is invented.
   */
  readonly planFile: string | null;
  readonly milestone: string;
  /** The sibling repository (absolute, or relative to `invokingRepo`). */
  readonly siblingPath: string;
  /**
   * Run the checks only (the join's dry run, AC-STE-610.4): the sibling's plan
   * may sit in any git source, and nothing is written.
   */
  readonly dryRun?: boolean;
}

/** Everything the checks established — what the writer needs. */
export interface VerifiedSpan {
  /** The invoking repository's main worktree root (the invoking checkout when it has none). */
  readonly invokingRoot: string;
  /** The sibling repository's main worktree root. */
  readonly siblingRoot: string;
  readonly invokingTag: string;
  readonly siblingTag: string;
  /** The invoking plan's text, as read. */
  readonly planBody: string;
  /** The sibling's plan copy the checks graded: its main-worktree copy when it has one. */
  readonly siblingPlan: { readonly source: string; readonly body: string };
  /** True when `siblingPlan` sits in the sibling's main worktree (writable there). */
  readonly siblingPlanInMainWorktree: boolean;
}

/** A declare refused: the message is NFR-10 three-line, a reader's own when one refused. */
export class SpanDeclareError extends Error {
  override readonly name = "SpanDeclareError";
}

const DECLARE_USAGE =
  "bun run adapters/_shared/src/spans_repos.ts <planFile> <milestone> --declare <siblingPath>";

function declareRefusal(refusing: string, remedy: string, context: string): SpanDeclareError {
  return new SpanDeclareError(
    nfr10Refusal(refusing, remedy, `mode=spans-repos-declare, ${context}`),
  );
}

/** Run a reader, turning its own refusal into a declare refusal carrying the same text. */
function readerOwnText<T>(read: () => T): T {
  try {
    return read();
  } catch (e) {
    if (e instanceof SpansReposError || e instanceof WorkspaceBindingError) {
      throw new SpanDeclareError(e.message);
    }
    throw e;
  }
}

/**
 * Verify a sibling before a span is declared (AC-STE-610.1). Every check
 * refuses with a `SpanDeclareError` naming it; nothing is written by any
 * check. With `dryRun` the sibling's plan may sit in any git source; without
 * it the plan must be in the sibling's main worktree, where the
 * back-reference is written.
 */
export async function verifySpan(input: DeclareSpanInput): Promise<VerifiedSpan> {
  const { invokingRepo, planFile, milestone } = input;
  const shown = (p: string): string => `\`${oneLine(p)}\``;

  // The invoking plan — the plan reader's own refusal text, then the
  // declaration reader's. A dry run with no plan yet (the join, before this
  // side's plan is written) has no invoking plan to grade.
  let planBody = "";
  if (planFile === null) {
    if (input.dryRun !== true) {
      throw declareRefusal(
        "to declare spans_repos without the invoking plan file.",
        `${DECLARE_USAGE} — pass a readable milestone plan file.`,
        "phase=plan-read, error=no-plan-file",
      );
    }
  } else {
    try {
      planBody = readFileSync(planFile, "utf-8");
    } catch (e) {
      const code = (e as { code?: string }).code ?? "unknown";
      throw declareRefusal(
        `to declare spans_repos — the plan file ${shown(planFile)} cannot be read.`,
        `${DECLARE_USAGE} — pass a readable milestone plan file.`,
        `phase=plan-read, error=${code}`,
      );
    }
    readerOwnText(() => readSpansReposDeclaration(planBody));
  }

  // The sibling: present, a git repository, a different one, toolkit-managed.
  // Located through the shared repo probe: a relative path resolves against
  // the invoking checkout, and a missing path (or a non-directory) is null.
  const siblingPath = defaultRepoProbe(invokingRepo).locate(input.siblingPath);
  if (siblingPath === null) {
    throw declareRefusal(
      `to declare spans_repos — the sibling path ${shown(input.siblingPath)} does not exist (or is not a directory).`,
      "pass the path of the sibling repository's checkout.",
      "phase=sibling-path, check=exists",
    );
  }
  const siblingRoot = mainWorktreeRoot(siblingPath);
  if (siblingRoot === null) {
    throw declareRefusal(
      `to declare spans_repos — the sibling ${shown(siblingPath)} is not a git repository with a main worktree.`,
      "pass the checkout of the sibling git repository; a span is declared between two git repositories.",
      "phase=sibling-path, check=git-repository",
    );
  }
  if (sameRepository(siblingPath, invokingRepo)) {
    throw declareRefusal(
      `to declare spans_repos — the sibling ${shown(siblingPath)} is the same repository as the invoking checkout ${shown(invokingRepo)} (a worktree of it, or the checkout itself).`,
      "pass the checkout of a DIFFERENT repository; a milestone in one repository needs no spans_repos.",
      "phase=sibling-path, check=same-repository",
    );
  }
  if (!isToolkitManaged(siblingPath)) {
    throw declareRefusal(
      `to declare spans_repos — the sibling ${shown(siblingPath)} is not toolkit-managed (its CLAUDE.md carries no toolkit signal).`,
      "the sibling repository's own operator runs /dev-process-toolkit:setup there, from its own session — do not bootstrap it from here.",
      "phase=sibling-claude-md, check=toolkit-managed",
    );
  }

  // Both CLAUDE.md files: the same tracker mode and project, two distinct tags.
  const invokingClaude = join(invokingRepo, "CLAUDE.md");
  const siblingClaude = join(siblingPath, "CLAUDE.md");
  const invokingMode = readTaskTrackingSection(invokingClaude)["mode"] ?? "";
  const siblingMode = readTaskTrackingSection(siblingClaude)["mode"] ?? "";
  if (invokingMode !== siblingMode) {
    throw declareRefusal(
      `to declare spans_repos — the tracker modes differ: the invoking repository binds mode \`${oneLine(invokingMode) || "(none declared)"}\`, the sibling ${shown(siblingPath)} binds mode \`${oneLine(siblingMode) || "(none declared)"}\`.`,
      "a span joins two repositories on ONE tracker — bind both CLAUDE.md files to the same `mode:`.",
      `phase=claude-md, check=tracker-mode, invoking_mode=${oneLine(invokingMode)}, sibling_mode=${oneLine(siblingMode)}`,
    );
  }
  if (invokingMode !== "linear" && invokingMode !== "jira") {
    throw declareRefusal(
      `to declare spans_repos — mode \`${oneLine(invokingMode) || "(none declared)"}\` has no tracker to carry a \`repo_tag\`, so no entry name can be read.`,
      "hand-write the spans_repos declaration in both plans, naming each repository yourself.",
      `phase=claude-md, check=tracker-mode, mode=${oneLine(invokingMode)}`,
    );
  }
  const invokingBinding: WorkspaceBinding = readerOwnText(() =>
    readWorkspaceBinding(invokingClaude, invokingMode),
  );
  const siblingBinding: WorkspaceBinding = readerOwnText(() =>
    readWorkspaceBinding(siblingClaude, invokingMode),
  );
  if ((invokingBinding.project ?? "") !== (siblingBinding.project ?? "")) {
    throw declareRefusal(
      `to declare spans_repos — the tracker projects differ: the invoking repository binds project \`${oneLine(invokingBinding.project ?? "(none declared)")}\`, the sibling ${shown(siblingPath)} binds project \`${oneLine(siblingBinding.project ?? "(none declared)")}\`.`,
      "a span joins two repositories in ONE tracker container — bind both CLAUDE.md files to the same `project:`.",
      `phase=claude-md, check=tracker-project, mode=${invokingMode}`,
    );
  }
  for (const [side, binding, where] of [
    ["invoking", invokingBinding, invokingClaude],
    ["sibling", siblingBinding, siblingClaude],
  ] as const) {
    if (binding.repoTag === undefined) {
      throw declareRefusal(
        `to declare spans_repos — the ${side} repository's CLAUDE.md ${shown(where)} declares no \`repo_tag\`, so its entry has no name to read.`,
        "declare `repo_tag` (and `min_dpt_version`) in its tracker sub-section, or hand-write the spans_repos declaration in both plans — no name is invented.",
        `phase=claude-md, check=repo-tag, side=${side}`,
      );
    }
  }
  const invokingTag = invokingBinding.repoTag!;
  const siblingTag = siblingBinding.repoTag!;
  if (invokingTag === siblingTag) {
    throw declareRefusal(
      `to declare spans_repos — both repositories declare repo_tag \`${oneLine(invokingTag)}\`; the two entries would share one name.`,
      "give each repository its own `repo_tag` in its CLAUDE.md tracker sub-section.",
      `phase=claude-md, check=repo-tag-distinct, repo_tag=${oneLine(invokingTag)}`,
    );
  }

  // The sibling's plan for the milestone, read from git (STE-609).
  let plans: Array<{ source: string; body: string }>;
  try {
    plans = (await readSiblingFrsFromGit(siblingRoot, milestone)).plans;
  } catch (e) {
    if (!(e instanceof SiblingReadError)) throw e;
    throw declareRefusal(
      `to declare spans_repos — the sibling ${shown(siblingRoot)} cannot be read from git: ${oneLine(e.message)}.`,
      "repair the sibling repository so git can read it, then declare again.",
      "phase=sibling-plan, check=git-read",
    );
  }
  if (plans.length === 0) {
    throw declareRefusal(
      `to declare spans_repos — the sibling ${shown(siblingRoot)} holds no plan for milestone ${oneLine(milestone)} (live or archived) in any worktree, local branch or remote-tracking ref.`,
      `have the sibling repository plan ${oneLine(milestone)} from ITS OWN session — do not write into ${shown(siblingRoot)} from here; a span joins a milestone both repositories plan, and each plans its own.`,
      `phase=sibling-plan, check=plan-exists, milestone=${oneLine(milestone)}`,
    );
  }
  const mainSource = `worktree ${siblingRoot}`;
  const inMain = plans.find((p) => p.source === mainSource);
  const siblingPlan = inMain ?? plans[0]!;
  readerOwnText(() => readSpansReposDeclaration(siblingPlan.body));
  if (inMain === undefined && input.dryRun !== true) {
    const refs = [...new Set(plans.map((p) => oneLine(p.source)))].join(", ");
    throw declareRefusal(
      `to declare spans_repos — the sibling's plan for ${oneLine(milestone)} is not in its main worktree ${shown(siblingRoot)}; it is held by ${refs}, and the back-reference cannot be written into a branch that is not checked out.`,
      `check out the branch holding the plan in the sibling's main worktree (or merge it there), then declare again.`,
      `phase=sibling-plan, check=plan-in-main-worktree, milestone=${oneLine(milestone)}`,
    );
  }

  return {
    invokingRoot: mainWorktreeRoot(invokingRepo) ?? invokingRepo,
    siblingRoot,
    invokingTag,
    siblingTag,
    planBody,
    siblingPlan,
    siblingPlanInMainWorktree: inMain !== undefined,
  };
}

/** What a declare established and the plan files it wrote. */
export interface DeclaredSpan extends VerifiedSpan {
  /** The sibling's plan file in its main worktree (null on a dry run). */
  readonly siblingPlanFile: string | null;
  /** The plan files written, invoking first. */
  readonly written: readonly string[];
}

/**
 * Insert one `spans_repos:` block just before the frontmatter's closing fence,
 * keeping every other byte (BOM and line endings included). Returns null when
 * the text has no frontmatter to insert into.
 */
function insertSpanBlock(
  body: string,
  entries: ReadonlyArray<readonly [string, string]>,
): string | null {
  // The shared write-side splitter: it reads the line ending the FRONTMATTER
  // uses (never a whole-file guess, which a CRLF snippet in an LF plan's body
  // would fool) and carries the BOM and everything after the closing fence
  // through byte for byte.
  const split = splitFrontmatter(body);
  if (split === null) return null;
  const block = [
    `${SPANS_REPOS_KEY}:`,
    ...entries.map(([name, path]) => `  ${name}: ${path}`),
  ];
  return joinFrontmatter(split, [...split.lines, ...block]);
}

/**
 * Two declared paths name the same place when their text is equal, or when
 * they resolve LEXICALLY (path.resolve against the plan's main worktree root,
 * no filesystem access) to the same absolute path — so `../x` and `../x/`
 * are not a conflict, and a path that does not exist still compares.
 */
function samePlace(root: string, a: string, b: string): boolean {
  return a === b || resolve(root, a) === resolve(root, b);
}

/**
 * Grade a plan's existing spans_repos against the two entries the declare
 * would write. Identical ⇒ returns (nothing to write). A tag mapped to a
 * different path, or any other declared shape (extra, foreign or missing
 * entries), refuses — never merged, never overwritten.
 */
function gradeExistingDeclaration(
  file: string,
  root: string,
  existing: readonly SpansReposEntry[],
  computed: ReadonlyArray<readonly [string, string]>,
): void {
  const shownFile = `\`${oneLine(file)}\``;
  for (const [name, path] of computed) {
    const hit = existing.find((e) => e.name === name);
    if (hit !== undefined && !samePlace(root, hit.declaredPath, path)) {
      throw declareRefusal(
        `to declare spans_repos — the plan ${shownFile} already maps \`${oneLine(name)}\` to \`${oneLine(hit.declaredPath)}\`, but the declare computes \`${oneLine(path)}\` for it; the existing declaration is not overwritten.`,
        `correct or delete the spans_repos entry \`${oneLine(name)}\` in ${shownFile} (the computed path is \`${oneLine(path)}\`), then declare again.`,
        `phase=plan-existing, check=path-conflict, entry=${oneLine(name)}`,
      );
    }
  }
  const identical =
    existing.length === computed.length &&
    computed.every(([name]) => existing.some((e) => e.name === name));
  if (identical) return;
  const there = existing
    .map((e) => `\`${oneLine(e.name)}: ${oneLine(e.declaredPath)}\``)
    .join(", ");
  const want = computed.map(([n, p]) => `\`${oneLine(n)}: ${oneLine(p)}\``).join(", ");
  throw declareRefusal(
    `to declare spans_repos — the plan ${shownFile} already declares ${there}, which is not the two entries ${want} the declare would write; it is neither merged nor overwritten.`,
    `edit the spans_repos declaration in ${shownFile} by hand, or delete it and declare again.`,
    `phase=plan-existing, check=foreign-entries, entries=${existing.length}`,
  );
}

/**
 * Declare a milestone's span in both plans (STE-610). Verifies first
 * (`verifySpan`) and refuses before anything is written; both new texts are
 * built before either write, and a failed second write restores the first.
 */
export async function declareSpan(input: DeclareSpanInput): Promise<DeclaredSpan> {
  const verified = await verifySpan(input);
  if (input.dryRun === true) return { ...verified, siblingPlanFile: null, written: [] };
  const { invokingRoot, siblingRoot, invokingTag, siblingTag, planBody, siblingPlan } = verified;

  // The sibling's plan FILE in its main worktree: the one whose text the checks graded.
  const siblingPlanFile = planRelPaths(input.milestone)
    .map((rel) => join(siblingRoot, rel))
    .find((file) => {
      try {
        return readFileSync(file, "utf-8") === siblingPlan.body;
      } catch {
        return false;
      }
    });
  if (siblingPlanFile === undefined) {
    throw declareRefusal(
      `to declare spans_repos — the sibling's plan for ${oneLine(input.milestone)} changed in its main worktree \`${oneLine(siblingRoot)}\` while it was being verified.`,
      "declare again.",
      "phase=sibling-plan, check=plan-file",
    );
  }

  // Paths run between the two MAIN worktree roots (STE-609).
  const toSibling = relative(invokingRoot, siblingRoot);
  const toInvoking = relative(siblingRoot, invokingRoot);
  const edits: Array<{ file: string; before: string; after: string }> = [];
  // Every existing declaration is graded BEFORE any write: a side already
  // carrying exactly the two computed entries is left untouched (idempotent),
  // and any other declaration refuses — nothing is merged or overwritten.
  const sides = [
    [input.planFile!, planBody, invokingRoot, [[invokingTag, "."], [siblingTag, toSibling]]],
    [siblingPlanFile, siblingPlan.body, siblingRoot, [[siblingTag, "."], [invokingTag, toInvoking]]],
  ] as const;
  const pending: Array<(typeof sides)[number]> = [];
  for (const side of sides) {
    const [file, before, root, entries] = side;
    const existing = readSpansReposDeclaration(before);
    if (!existing.declared) {
      pending.push(side);
      continue;
    }
    gradeExistingDeclaration(file, root, existing.entries, entries);
  }
  for (const [file, before, , entries] of pending) {
    const after = insertSpanBlock(before, entries);
    if (after === null) {
      throw declareRefusal(
        `to declare spans_repos — the plan \`${oneLine(file)}\` has no frontmatter block to insert the declaration into.`,
        "give the plan its `---` frontmatter, then declare again.",
        "phase=plan-write, check=frontmatter",
      );
    }
    edits.push({ file, before, after });
  }

  // Drift guard, as late as possible: each plan is re-read just before the
  // writes and must still hold the bytes it was graded on — a concurrent edit
  // (another declare, a hand edit) refuses rather than being clobbered.
  for (const edit of edits) {
    let now: string | null;
    try {
      now = readFileSync(edit.file, "utf-8");
    } catch {
      now = null;
    }
    if (now !== edit.before) {
      throw declareRefusal(
        `to declare spans_repos — the plan \`${oneLine(edit.file)}\` changed while it was being verified, so nothing was written.`,
        "declare again.",
        "phase=plan-write, check=drift",
      );
    }
  }
  const written: string[] = [];
  for (const edit of edits) {
    try {
      writeFileSync(edit.file, edit.after, "utf-8");
      written.push(edit.file);
    } catch (e) {
      const code = (e as { code?: string }).code ?? "unknown";
      // Never leave one side half-declared: restore what was already written.
      // A failed restore is reported, never lost: the refusal names the plan
      // left declared so the operator can revert it by hand.
      const unrestored: string[] = [];
      for (const done of edits.filter((d) => written.includes(d.file))) {
        try {
          writeFileSync(done.file, done.before, "utf-8");
        } catch {
          unrestored.push(done.file);
        }
      }
      throw declareRefusal(
        unrestored.length === 0
          ? `to declare spans_repos — the plan \`${oneLine(edit.file)}\` cannot be written; ${written.length > 0 ? "the plan already written was restored, so " : ""}neither plan is declared.`
          : `to declare spans_repos — the plan \`${oneLine(edit.file)}\` cannot be written, and restoring ${unrestored.map((f) => `\`${oneLine(f)}\``).join(", ")} failed: that plan is left declared.`,
        unrestored.length === 0
          ? "make the plan file writable, then declare again."
          : "remove the spans_repos: block from the plan left declared by hand, make both plan files writable, then declare again.",
        `phase=plan-write, error=${code}`,
      );
    }
  }
  return { ...verified, siblingPlanFile, written };
}

/** One stdout line for one resolved entry, fields whitespace-separated. */
function formatSiblingState(state: SiblingState): string {
  // A plan's declared names and paths may be a sibling's hand-written text.
  const fields = [oneLine(state.name), state.self ? "self" : "sibling", oneLine(state.declaredPath)];
  if (state.root === null) {
    fields.push("root=UNLOCATABLE");
  } else {
    fields.push(`root=${state.root}`);
    if (state.binding !== null) {
      fields.push(
        `active=${state.binding.activeFrIds.length}`,
        `archived=${state.binding.archivedFrIds.length}`,
      );
    }
  }
  return fields.join(" ");
}

// Command-line front door:
//
//   bun run spans_repos.ts <planFile> <milestone> [invokingRepo]
//
// Prints one line per declared entry, resolved by `resolveSpansRepos`. An
// undeclared plan prints nothing and exits 0 — empty stdout means none.
// Incomplete argv, an unreadable plan and a malformed declaration refuse on
// stderr only (NFR-10 three-line shape), print nothing, and exit 1.
//
//   bun run spans_repos.ts <planFile> <milestone> --declare <siblingPath>
//
// Declares the span from the invoking checkout (cwd): one stdout line per plan
// written (or one "already declared" line when both already carry exactly the
// two entries), plus a reminder to commit the sibling's plan there. A refusal
// prints the NFR-10 message on stderr only, writes nothing, and exits 1.
if (import.meta.main && process.argv[4] === "--declare") {
  const [planFile, milestone, , siblingPath] = process.argv.slice(2);
  try {
    if (siblingPath === undefined || siblingPath === "") {
      throw declareRefusal(
        "to declare spans_repos without a sibling path.",
        DECLARE_USAGE,
        "phase=argv, argv=incomplete",
      );
    }
    const declared = await declareSpan({
      invokingRepo: process.cwd(),
      planFile: planFile!,
      milestone: milestone!,
      siblingPath,
    });
    if (declared.written.length === 0) {
      console.log("spans_repos already declared in both plans — nothing written.");
    }
    for (const file of declared.written) console.log(`spans_repos declared in ${oneLine(file)}`);
    if (declared.siblingPlanFile !== null && declared.written.includes(declared.siblingPlanFile)) {
      console.log(
        `The sibling's plan is left uncommitted in ${oneLine(declared.siblingRoot)} — commit ${oneLine(relative(declared.siblingRoot, declared.siblingPlanFile))} there.`,
      );
    }
  } catch (e) {
    if (!(e instanceof SpanDeclareError)) throw e;
    console.error(e.message);
    process.exitCode = 1;
  }
} else if (import.meta.main) {
  const [planFile, milestone, invokingRepoArg] = process.argv.slice(2);
  const usage =
    "bun run adapters/_shared/src/spans_repos.ts <planFile> <milestone> [invokingRepo]";
  if (planFile === undefined || milestone === undefined) {
    const missing = planFile === undefined ? "a plan file and a milestone" : "a milestone";
    console.error(
      nfr10Refusal(
        `to resolve spans_repos without ${missing}.`,
        usage,
        "mode=spans-repos, phase=argv, argv=incomplete",
      ),
    );
    process.exitCode = 1;
  } else {
    let planBody: string | null = null;
    try {
      planBody = readFileSync(planFile, "utf-8");
    } catch (e) {
      const code = (e as { code?: string }).code ?? "unknown";
      console.error(
        nfr10Refusal(
          `to resolve spans_repos — the plan file \`${planFile}\` cannot be read.`,
          `${usage} — pass a readable milestone plan file.`,
          `mode=spans-repos, phase=plan-read, error=${code}`,
        ),
      );
      process.exitCode = 1;
    }
    if (planBody !== null) {
      try {
        const states = await resolveSpansRepos({
          planBody,
          milestone,
          invokingRepo: invokingRepoArg ?? process.cwd(),
        });
        for (const state of states) console.log(formatSiblingState(state));
      } catch (e) {
        if (!(e instanceof SpansReposError)) throw e;
        console.error(e.message);
        process.exitCode = 1;
      }
    }
  }
}

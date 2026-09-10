// A milestone plan's `spans_repos:` declaration — the repositories one
// milestone's work lives in.
//
// The key is read ONLY through the shared frontmatter parser, which already
// normalizes CRLF / lone-CR / BOM and reads a nested map at 2-space, 4-space
// and tab indentation. No line scan of our own: a second reader of the same
// block would be a second home for the same fact.

import { readFileSync } from "node:fs";
import { milestoneFrBinding } from "./active_plan_ship_ready";
import { parseFrontmatter } from "./frontmatter";
import { defaultRepoProbe, isUndeclaredScalar, sameRepo, type RepoProbe } from "./target_repo";

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
 * Locating defers to the shared repo probe, same-repo to `sameRepo`, and the
 * binding to `milestoneFrBinding` — each fact keeps its one home. The self
 * entry and an unlocatable entry carry no binding.
 */
export async function resolveSpansRepos(
  input: ResolveSpansReposInput,
): Promise<SiblingState[]> {
  const { planBody, milestone, invokingRepo } = input;
  const declaration = readSpansReposDeclaration(planBody);
  if (!declaration.declared) return [];
  const probe = input.probe ?? defaultRepoProbe(invokingRepo);
  const states: SiblingState[] = [];
  for (const { name, declaredPath } of declaration.entries) {
    const root = probe.locate(declaredPath);
    const self = root !== null && sameRepo(root, invokingRepo);
    const binding =
      root !== null && !self ? await milestoneFrBinding(root, milestone) : null;
    states.push({ name, declaredPath, root, self, binding });
  }
  return states;
}

/** One stdout line for one resolved entry, fields whitespace-separated. */
function formatSiblingState(state: SiblingState): string {
  const fields = [state.name, state.self ? "self" : "sibling", state.declaredPath];
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
if (import.meta.main) {
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

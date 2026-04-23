// Branch-naming automation (STE-64).
//
// Pure functions, no I/O. The LLM pass that returns `{type, slug}` lives
// in the skill (adapters stay deterministic — NFR-8). Callers invoke
// `buildBranchProposal` to render a proposal and `isCurrentBranchAcceptable`
// to decide whether the branch prompt should fire at all.
//
// Shell-injection defense (AC-STE-64.13): LLM output is clamped to
// `[a-z0-9-]` before template substitution — `git checkout -b` already
// quotes the argument, but defense in depth. Adversarial inputs (backticks,
// `$()`, newlines, path-traversal `../`, Unicode homoglyphs, …) can never
// escape the sanitizer.

const ALLOWED_TYPES = new Set(["feat", "fix", "chore"]);
const MAX_BRANCH_LENGTH = 60;

/**
 * Context needed to render a branch proposal. The FR / milestone-plan
 * identity is pre-extracted by the caller (skill responsibility); the
 * adapter's job is pure template rendering + sanitization.
 */
export interface BranchProposalContext {
  /** Schema L `branch_template:` value, e.g. `"{type}/m{N}-{slug}"`. */
  template: string;
  /** Raw LLM-returned `{type}`; will be clamped. */
  type: string;
  /** Raw LLM-returned `{slug}`; will be sanitized. */
  slug: string;
  /** Milestone number (digits only), e.g. `"19"`. Substitutes `{N}`. */
  milestone?: string;
  /** Tracker ID, e.g. `"STE-64"`. Substitutes `{ticket-id}` in tracker mode. */
  trackerId?: string;
  /** Short-ULID tail (lowercase), e.g. `"vdtaf4"`. Substitutes `{ticket-id}` in mode: none. */
  shortUlid?: string;
}

/**
 * Which scope is `/implement` running? Drives
 * `isCurrentBranchAcceptable`'s match rule (AC-STE-64.4).
 */
export type RunScope =
  | { kind: "milestone"; number: string }
  | { kind: "fr-tracker"; trackerId: string }
  | { kind: "fr-mode-none"; shortUlid: string };

/**
 * Thrown when the caller-supplied `{slug}` sanitizes to empty. Rendered by
 * the skill as an NFR-10 canonical-shape refusal (verdict / remedy /
 * context). Raising here rather than returning an empty string prevents
 * `feat/m19-` from ever reaching `git checkout -b`.
 */
export class EmptySlugError extends Error {
  readonly rawSlug: string;
  constructor(rawSlug: string) {
    super(
      `buildBranchProposal: slug "${rawSlug}" sanitized to empty; cannot render a branch name.\n` +
        `Remedy: press [e] at the prompt and supply a 2–4 word kebab-case slug using characters [a-z0-9-], or re-run after editing the FR title so the LLM can infer a cleaner slug.\n` +
        `Context: rawSlug="${rawSlug}", operation=buildBranchProposal`,
    );
    this.name = "EmptySlugError";
    this.rawSlug = rawSlug;
  }
}

/** Strip-to-[a-z0-9-], collapse hyphen runs, trim leading/trailing hyphens. */
function sanitizeSlug(raw: string): string {
  const kept = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return kept;
}

/** Clamp to allowed type set; unknown → `feat` (AC-STE-64.13). */
function clampType(raw: string): string {
  const cleaned = raw.toLowerCase().replace(/[^a-z]/g, "");
  return ALLOWED_TYPES.has(cleaned) ? cleaned : "feat";
}

/** Resolve the `{ticket-id}` substitution per context (AC-STE-64.7). */
function resolveTicketId(ctx: BranchProposalContext): string {
  if (ctx.trackerId) return ctx.trackerId.toLowerCase();
  if (ctx.shortUlid) return ctx.shortUlid.toLowerCase();
  return "";
}

/**
 * Render a branch proposal from the template. Handles sanitization,
 * substitution, 60-char truncation clamp (slug-only), and NFR-10 refusal
 * on empty-post-sanitize slug.
 */
export function buildBranchProposal(ctx: BranchProposalContext): string {
  const cleanSlug = sanitizeSlug(ctx.slug);
  if (cleanSlug.length === 0) {
    throw new EmptySlugError(ctx.slug);
  }
  const cleanType = clampType(ctx.type);
  const ticketId = resolveTicketId(ctx);
  const milestone = ctx.milestone ?? "";

  // Render with empty slug first to compute the slug budget.
  const renderedWithoutSlug = ctx.template
    .replace(/{type}/g, cleanType)
    .replace(/{N}/g, milestone)
    .replace(/{ticket-id}/g, ticketId)
    .replace(/{slug}/g, "");

  const budget = MAX_BRANCH_LENGTH - renderedWithoutSlug.length;
  let finalSlug = cleanSlug;
  if (budget < cleanSlug.length) {
    finalSlug = cleanSlug.slice(0, Math.max(0, budget)).replace(/-+$/g, "");
  }

  return ctx.template
    .replace(/{type}/g, cleanType)
    .replace(/{N}/g, milestone)
    .replace(/{ticket-id}/g, ticketId)
    .replace(/{slug}/g, finalSlug);
}

/**
 * Is the current git branch acceptable for the given run scope?
 *
 * Rule (AC-STE-64.4): acceptable IFF current branch is not `main`/`master`
 * AND the branch name contains the scope's identifier — `m{N}` for a
 * milestone run (word-boundary match so `m19` does not accept `m191`), or
 * the tracker ID / short-ULID (substring match, case-insensitive) for an
 * FR run.
 */
export function isCurrentBranchAcceptable(branchName: string, scope: RunScope): boolean {
  const lower = branchName.toLowerCase();
  if (lower === "main" || lower === "master") return false;

  if (scope.kind === "milestone") {
    const re = new RegExp(`\\bm${scope.number}\\b`, "i");
    return re.test(branchName);
  }
  if (scope.kind === "fr-tracker") {
    return lower.includes(scope.trackerId.toLowerCase());
  }
  return lower.includes(scope.shortUlid.toLowerCase());
}

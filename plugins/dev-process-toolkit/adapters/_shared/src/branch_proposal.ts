// Branch-naming automation (STE-64).
//
// Pure functions, no I/O. `{type}` is derived deterministically via
// `branchTypeFor` (`branch_type_for.ts`, keyed on the FR's
// `changelog_category` frontmatter — STE-381); the LLM pass, rescoped to
// `{slug}` only, lives in the skill (adapters stay deterministic — NFR-8).
// Callers invoke `buildBranchProposal` to render a proposal and
// `isCurrentBranchAcceptable` to decide whether the branch prompt should
// fire at all.
//
// Shell-injection defense (AC-STE-64.13): LLM output is clamped to
// `[a-z0-9-]` before template substitution — `git checkout -b` already
// quotes the argument, but defense in depth. Adversarial inputs (backticks,
// `$()`, newlines, path-traversal `../`, Unicode homoglyphs, …) can never
// escape the sanitizer.

// ALLOWED_TYPES mirrors the commit-msg hook's accept set
// (`templates/git-hooks/commit-msg.sh`) minus `ci` — STE-228 TRUNK_OK_TYPES
// excludes `ci:` from per-branch flow because `ci:` commits land on trunk.
// Expanded from 3 → 10 entries by AC-STE-324.2.
const ALLOWED_TYPES = new Set([
  "feat",
  "fix",
  "chore",
  "docs",
  "style",
  "refactor",
  "perf",
  "test",
  "build",
  "revert",
]);
const MAX_BRANCH_LENGTH = 60;

/**
 * Branch names treated as protected trunks. Single source of truth —
 * `requireCommittableBranch` re-exports this so both branch helpers
 * agree on what counts as `main` / `master`.
 */
export const PROTECTED_TRUNKS = ["main", "master"] as const;

/** True when `branch` (case-insensitive) is one of `PROTECTED_TRUNKS`. */
export function isProtectedTrunk(branch: string): boolean {
  return (PROTECTED_TRUNKS as readonly string[]).includes(branch.toLowerCase());
}

/**
 * The two Schema L branch-template forms (STE-388). Single home for the
 * literals — `canonicalBranchTemplate` selects between them and
 * `setup/migrate_branch_template.ts` re-seeds from the ticket-keyed form.
 */
export const MILESTONE_BRANCH_TEMPLATE = "{type}/m{N}-{slug}";
export const TICKET_BRANCH_TEMPLATE = "{type}/{ticket-id}-{slug}";

/**
 * Canonical branch template for a given milestone binding (STE-388).
 *
 * Pure selector: a non-empty all-digit `milestone` yields the
 * milestone-keyed form `"{type}/m{N}-{slug}"`; anything else (absent,
 * empty, or non-digit) falls back to the ticket-keyed form
 * `"{type}/{ticket-id}-{slug}"`.
 */
export function canonicalBranchTemplate({ milestone }: { milestone?: string }): string {
  return milestone !== undefined && /^\d+$/.test(milestone)
    ? MILESTONE_BRANCH_TEMPLATE
    : TICKET_BRANCH_TEMPLATE;
}

/**
 * Context needed to render a branch proposal. The FR / milestone-plan
 * identity is pre-extracted by the caller (skill responsibility); the
 * adapter's job is pure template rendering + sanitization.
 */
export interface BranchProposalContext {
  /** Schema L `branch_template:` value, e.g. `"{type}/m{N}-{slug}"`. */
  template: string;
  /** Derived `{type}` (callers pass `branchTypeFor`'s result); will be clamped. */
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
 *
 * FR-scoped variants optionally carry `milestoneNumber` (AC-STE-388.5):
 * when present, a word-bounded `m<N>` branch match is accepted as an
 * alternative to the tracker-ID / short-ULID substring, so both the
 * milestone-keyed and legacy ticket-keyed naming generations pass.
 */
export type RunScope =
  | { kind: "milestone"; number: string }
  | { kind: "fr-tracker"; trackerId: string; milestoneNumber?: string }
  | { kind: "fr-mode-none"; shortUlid: string; milestoneNumber?: string };

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
    // Non-slug parts alone ate the budget. Truncating to empty would render
    // a malformed branch like `feat/m19-` — fail loud rather than hand a
    // trailing-hyphen branch name to `git checkout -b`.
    if (finalSlug.length === 0) {
      throw new EmptySlugError(ctx.slug);
    }
  }

  return ctx.template
    .replace(/{type}/g, cleanType)
    .replace(/{N}/g, milestone)
    .replace(/{ticket-id}/g, ticketId)
    .replace(/{slug}/g, finalSlug);
}

/** Word-bounded `m<N>` match (case-insensitive) so `m19` ≠ `m191` / `dm19`. */
function matchesMilestone(branchName: string, milestoneNumber: string): boolean {
  return new RegExp(`\\bm${milestoneNumber}\\b`, "i").test(branchName);
}

/**
 * Is the current git branch acceptable for the given run scope?
 *
 * Rule (AC-STE-64.4, extended by AC-STE-388.5): acceptable IFF current
 * branch is not `main`/`master` AND the branch name matches the scope —
 * `m{N}` for a milestone run (word-boundary match so `m19` does not accept
 * `m191`); for an FR run, the tracker ID / short-ULID (substring match,
 * case-insensitive) OR, when the scope carries `milestoneNumber`, a
 * word-bounded `m<N>` match (legacy ticket-keyed branches stay acceptable).
 */
export function isCurrentBranchAcceptable(branchName: string, scope: RunScope): boolean {
  const lower = branchName.toLowerCase();
  if (isProtectedTrunk(lower)) return false;

  if (scope.kind === "milestone") {
    return matchesMilestone(branchName, scope.number);
  }
  if (scope.milestoneNumber !== undefined && matchesMilestone(branchName, scope.milestoneNumber)) {
    return true;
  }
  if (scope.kind === "fr-tracker") {
    return lower.includes(scope.trackerId.toLowerCase());
  }
  return lower.includes(scope.shortUlid.toLowerCase());
}

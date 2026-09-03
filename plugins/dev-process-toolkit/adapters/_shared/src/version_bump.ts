// STE-73 AC-STE-73.3 — semver-bump inference for /ship-milestone.
//
// Consumes a milestone's FR summaries + the current plugin.json version
// and emits the next version plus a short rationale the /ship-milestone
// approval diff embeds.
//
// Rules:
// - any FR flagged `breaking: true` in frontmatter         → major bump
// - milestone where every FR's category resolves to        → patch bump
//   `Fixed` / `Removed` (pure fix-class milestone)
// - otherwise                                              → minor bump
// - `--version X.Y.Z` override wins if it parses as semver
//
// Both frontmatter spellings are accepted on the way in, so an FR handed over
// exactly as read off disk decides the same bump as a hand-mapped one:
// - category: `changelogCategory` (camel) wins, the frontmatter
//   `changelog_category` (snake) is the fallback, `Added` applies only when
//   neither key is present — see `categoryOf`
// - tracker id: the flat `trackerId` wins, the nested frontmatter `tracker:`
//   block is the fallback, otherwise `undefined` — see `trackerRefOf`

export interface FrSummary {
  trackerId?: string;
  /** Frontmatter shape: the id nests under a provider key, e.g. `linear: STE-544`. */
  tracker?: Record<string, string>;
  title: string;
  breaking?: boolean;
  changelogCategory?: "Added" | "Changed" | "Removed" | "Fixed" | string;
  /** Frontmatter spelling, preserved as read off disk. */
  changelog_category?: "Added" | "Changed" | "Removed" | "Fixed" | string;
}

export interface BumpContext {
  currentVersion: string;
  frs: FrSummary[];
  override?: string;
}

export interface BumpResult {
  version: string;
  rationale: string;
}

export class InvalidVersionError extends Error {
  readonly version: string;
  constructor(version: string, context: string) {
    super(`invalid semver "${version}" in ${context} — expected <major>.<minor>.<patch>`);
    this.name = "InvalidVersionError";
    this.version = version;
  }
}

export class InvalidOverrideError extends Error {
  readonly value: string;
  constructor(value: string) {
    super(`--version override "${value}" is not a valid semver — expected <major>.<minor>.<patch>`);
    this.name = "InvalidOverrideError";
    this.value = value;
  }
}

const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

function parseSemver(version: string, context: string): [number, number, number] {
  const m = SEMVER_RE.exec(version);
  if (!m) throw new InvalidVersionError(version, context);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

const FIX_CLASS = new Set(["Fixed", "Removed"]);

/**
 * The single category reader: the camel key wins, the frontmatter snake key is
 * the fallback, and `Added` applies ONLY when neither key is present — so the
 * default can no longer mask a present-but-unread value.
 */
export function categoryOf(fr: FrSummary): string {
  return fr.changelogCategory ?? fr.changelog_category ?? "Added";
}

/**
 * The single tracker reader: the flat camel key wins, the nested frontmatter
 * `tracker:` block is the fallback (its first value — the frontmatter carries
 * exactly one provider key), and neither shape present yields `undefined` so a
 * caller degrades deliberately rather than by accident.
 */
export function trackerRefOf(fr: FrSummary): string | undefined {
  if (fr.trackerId !== undefined) return fr.trackerId;
  const nested = fr.tracker;
  if (nested === undefined) return undefined;
  for (const value of Object.values(nested)) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

export function inferBump(ctx: BumpContext): BumpResult {
  if (ctx.override !== undefined) {
    if (!SEMVER_RE.test(ctx.override)) throw new InvalidOverrideError(ctx.override);
    return {
      version: ctx.override,
      rationale: `override: --version ${ctx.override} (user-provided)`,
    };
  }

  const [major, minor, patch] = parseSemver(ctx.currentVersion, "currentVersion");
  const breaking = ctx.frs.find((fr) => fr.breaking === true);
  if (breaking) {
    return {
      version: `${major + 1}.0.0`,
      rationale: `major bump: FR ${trackerRefOf(breaking) ?? breaking.title} marked breaking`,
    };
  }

  const count = ctx.frs.length;
  const allFixClass = count > 0 && ctx.frs.every((fr) => FIX_CLASS.has(categoryOf(fr)));
  if (allFixClass) {
    return {
      version: `${major}.${minor}.${patch + 1}`,
      rationale: `patch bump: milestone contains only fix-class FRs (${count})`,
    };
  }

  const label = count === 0 ? "default minor bump (no FRs in milestone)" : `minor bump: milestone shipped ${count} additive FRs`;
  return {
    version: `${major}.${minor + 1}.0`,
    rationale: label,
  };
}

// STE-73 AC-STE-73.3 — semver-bump inference for /ship-milestone.
//
// Consumes a milestone's FR summaries + the current plugin.json version
// and emits the next version plus a short rationale the /ship-milestone
// approval diff embeds.
//
// Rules:
// - any FR flagged `breaking: true` in frontmatter         → major bump
// - milestone where every FR's changelogCategory is        → patch bump
//   `Fixed` / `Removed` (pure fix-class milestone)
// - otherwise                                              → minor bump
// - `--version X.Y.Z` override wins if it parses as semver

export interface FrSummary {
  trackerId?: string;
  title: string;
  breaking?: boolean;
  changelogCategory?: "Added" | "Changed" | "Removed" | "Fixed" | string;
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
      rationale: `major bump: FR ${breaking.trackerId ?? breaking.title} marked breaking`,
    };
  }

  const count = ctx.frs.length;
  const allFixClass =
    count > 0 &&
    ctx.frs.every((fr) => FIX_CLASS.has(fr.changelogCategory ?? "Added"));
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

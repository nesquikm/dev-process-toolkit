// Release-surface agreement — README "Latest:" line vs the topmost CHANGELOG entry.
//
// THE DEFECT THIS EXISTS FOR (measured, shipped as `README.md:184` at bb8973f):
//
//   Latest: **v2.75.0 — "Pawl"** (M136, the ratchet that never ran: …)
//
// v2.75.0's *version* carrying v2.74.0's *codename* and a paragraph describing
// a different milestone. The README release-file entry is `kind: regex` with
// pattern `Latest: \*\*v(?<version>\d+\.\d+\.\d+) — `; its replacement stops at
// the em-dash, so the codename and the sentence after it were never rewritten
// by any release. Nothing checked the fields past the version, so the line went
// stale on every release since that entry was written.
//
// The contract modelled here is OBSERVABLE, not mechanical: README and CHANGELOG
// must agree on VERSION, CODENAME and MILESTONE, and each is reported as its own
// violation. Reporting them as one fact is precisely what would have stayed green
// for the defect's entire life — the version agreed the whole time.
//
// Nothing here hand-types a version or a codename. The CHANGELOG is the source of
// truth for what shipped; the milestone is derived from the plan file whose
// `shipped_in:` frontmatter names that release.

export interface PlanText {
  /** Path on disk, used only for diagnostics. */
  path: string;
  /** Full file text (frontmatter included). */
  text: string;
}

export interface ChangelogEntry {
  /** Bare semver, no leading `v`. */
  version: string;
  /** Release codename, quotes stripped. */
  codename: string;
  /** Release date as written in the heading, or `null` if absent. */
  date: string | null;
}

export interface ReadmeLatest {
  /** Bare semver, no leading `v` — normalized so it compares to a CHANGELOG entry. */
  version: string;
  codename: string;
  /** `M<N>` as named in the parenthetical. */
  milestone: string;
}

export type AgreementField = "latest_line" | "changelog" | "version" | "codename" | "milestone";

export interface AgreementViolation {
  field: AgreementField;
  /** What the CHANGELOG (or the plan that shipped in it) says. */
  expected: string | null;
  /** What the README's "Latest:" line says. */
  found: string | null;
  /** One-line human-readable explanation. */
  detail: string;
}

/**
 * Normalizes CRLF so line-anchored patterns can match. This repo has lost a whole
 * transform to CRLF twice (M114's Linear checkbox push, M113's colon-only readers).
 *
 * NO BOM STRIP, deliberately — not an oversight. The sibling modules that strip a
 * leading U+FEFF all match something at offset 0; nothing here does. The README
 * pattern is unanchored and matches mid-file; the CHANGELOG headings (`## [x] …`)
 * and the plan frontmatter keys (`milestone:`, `shipped_in:`) are line-anchored but
 * never sit on line 1, which is a `# Title` and a `---` respectively. A BOM
 * therefore cannot reach any of these matches.
 */
function normalize(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

/** Drops a single leading `v` so `v2.75.0` and `2.75.0` compare equal. */
function bareVersion(v: string): string {
  return v.replace(/^v/, "");
}

// `Latest: **v2.75.0 — "Laconic"** (M137, …)`
//
// Deliberately tolerant about the dash (em-dash today, but an en-dash or hyphen
// must not make the check silently unparseable — an unparseable README is
// reported as a violation, never as agreement).
const README_LATEST_RE =
  /Latest:\s*\*\*v(?<version>\d+\.\d+\.\d+)\s*[—–-]\s*"(?<codename>[^"]+)"\*\*\s*\((?<milestone>M\d+)\b/;

/** Parses the README's `Latest:` line. Returns `null` when the line is absent or malformed. */
export function parseReadmeLatest(readme: string): ReadmeLatest | null {
  const m = README_LATEST_RE.exec(normalize(readme));
  if (!m?.groups) return null;
  return {
    version: bareVersion(m.groups.version!),
    codename: m.groups.codename!,
    milestone: m.groups.milestone!,
  };
}

// `## [2.75.0] — 2026-09-01 — "Laconic"`
const CHANGELOG_HEADING_RE =
  /^##\s+\[v?(?<version>\d+\.\d+\.\d+)\]\s*(?:[—–-]\s*(?<date>[^—–\n"]*?)\s*)?[—–-]\s*"(?<codename>[^"\n]+)"\s*$/gm;

/** Parses every versioned CHANGELOG heading, newest first (document order). */
export function parseChangelogEntries(changelog: string): ChangelogEntry[] {
  const text = normalize(changelog);
  const out: ChangelogEntry[] = [];
  CHANGELOG_HEADING_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CHANGELOG_HEADING_RE.exec(text)) !== null) {
    const g = m.groups!;
    out.push({
      version: bareVersion(g.version!),
      codename: g.codename!,
      date: g.date?.trim() || null,
    });
  }
  return out;
}

/** The topmost (most recently released) CHANGELOG entry, or `null` if there is none. */
export function parseChangelogTop(changelog: string): ChangelogEntry | null {
  return parseChangelogEntries(changelog)[0] ?? null;
}

const PLAN_MILESTONE_RE = /^milestone:\s*(M\d+)\s*$/m;
const PLAN_SHIPPED_IN_RE = /^shipped_in:\s*(\S+)\s*$/m;

/**
 * Every milestone whose plan carries `shipped_in: <version>`, highest milestone
 * number first. A release can carry more than one milestone; the README names
 * one of them.
 */
export function findMilestonesForRelease(plans: PlanText[], version: string): string[] {
  const want = bareVersion(version.trim());
  const found: string[] = [];
  for (const plan of plans) {
    const text = normalize(plan.text);
    const shipped = PLAN_SHIPPED_IN_RE.exec(text)?.[1];
    // `shipped_in: null` is the template sentinel for "not shipped yet" — it is
    // not a stamp, and must never resolve a release.
    if (!shipped || shipped === "null") continue;
    if (bareVersion(stripQuotes(shipped)) !== want) continue;
    const milestone =
      PLAN_MILESTONE_RE.exec(text)?.[1] ?? /\b(M\d+)\.md$/.exec(plan.path)?.[1] ?? null;
    if (milestone && !found.includes(milestone)) found.push(milestone);
  }
  return found.sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)));
}

function stripQuotes(v: string): string {
  return v.replace(/^["']|["']$/g, "");
}

/**
 * The canonical milestone for a release — the highest-numbered one when a
 * release carried several. `null` when no plan claims the version.
 */
export function findMilestoneForRelease(plans: PlanText[], version: string): string | null {
  return findMilestonesForRelease(plans, version)[0] ?? null;
}

/**
 * The whole contract, as separate facts. Returns one violation per disagreeing
 * field — an empty array means the surfaces agree.
 *
 * Every expected value derives from the CHANGELOG's topmost entry (and the plan
 * that shipped in it), never from the README, so a stale README version cannot
 * drag the other expectations along with it and mask which field actually drifted.
 */
export function checkReleaseSurfaceAgreement(
  readme: string,
  changelog: string,
  plans: PlanText[],
): AgreementViolation[] {
  const top = parseChangelogTop(changelog);
  if (!top) {
    return [
      {
        field: "changelog",
        expected: null,
        found: null,
        detail:
          'CHANGELOG.md has no parseable `## [<version>] — <date> — "<Codename>"` heading; ' +
          "the release surfaces cannot be compared.",
      },
    ];
  }

  const latest = parseReadmeLatest(readme);
  if (!latest) {
    return [
      {
        field: "latest_line",
        expected: `Latest: **v${top.version} — "${top.codename}"** (M<N>, …)`,
        found: null,
        detail:
          "README.md has no parseable `Latest: **v<version> — \"<Codename>\"** (M<N>, …)` line; " +
          "an unparseable line is a violation, not agreement.",
      },
    ];
  }

  const violations: AgreementViolation[] = [];

  if (latest.version !== top.version) {
    violations.push({
      field: "version",
      expected: top.version,
      found: latest.version,
      detail: `README "Latest:" names v${latest.version}; the topmost CHANGELOG entry is v${top.version}.`,
    });
  }

  if (latest.codename !== top.codename) {
    violations.push({
      field: "codename",
      expected: top.codename,
      found: latest.codename,
      detail:
        `README "Latest:" names codename "${latest.codename}"; the topmost CHANGELOG entry is ` +
        `"${top.codename}". The README release-file entry rewrites only the version, so this ` +
        "field goes stale unless it is written by hand.",
    });
  }

  const milestones = findMilestonesForRelease(plans, top.version);
  const canonical = milestones[0] ?? null;
  if (milestones.length === 0) {
    violations.push({
      field: "milestone",
      expected: null,
      found: latest.milestone,
      detail:
        `No plan carries \`shipped_in: v${top.version}\`, so the milestone the README names ` +
        `(${latest.milestone}) cannot be confirmed against the release.`,
    });
  } else if (!milestones.includes(latest.milestone)) {
    violations.push({
      field: "milestone",
      expected: canonical,
      found: latest.milestone,
      detail:
        `README "Latest:" names ${latest.milestone}; v${top.version} shipped ` +
        `${milestones.join(", ")}.`,
    });
  }

  return violations;
}

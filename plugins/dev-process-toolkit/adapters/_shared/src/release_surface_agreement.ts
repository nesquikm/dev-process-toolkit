// Release-surface agreement — README "Latest:" line vs the CHANGELOG entry of the
// release being graded (STE-546: located by version match, never by position).
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

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { readDocsConfig } from "./docs_config";
// STE-556. Milestone recognition here was three private `M\d+` literals, and
// this module was never registered in the STE-335 AC-7 consumer audit — which
// is the only reason they survived a check written to prevent exactly them.
// M139's tracker-first scheme mints `M_<key>` ids, so the first milestone
// minted under it (`M_dc2ecb`) parsed as no milestone at all: measured on a
// fixture of its own post-release tree, this module returned a `latest_line`
// violation and exit 1, which aborts /ship-milestone before `git add`.
import { MILESTONE_TOKEN_SOURCE, parseMilestoneToken } from "./milestone_token";

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
const README_LATEST_RE = new RegExp(
  String.raw`Latest:\s*\*\*v(?<version>\d+\.\d+\.\d+)\s*[—–-]\s*"(?<codename>[^"]+)"\*\*\s*\((?<milestone>${MILESTONE_TOKEN_SOURCE})\b`,
);

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

/**
 * The literal that decides "this project adopted the release banner at all".
 *
 * MARKER, not parse success (AC-STE-546.5). A README that carries this and
 * nothing else parseable is a project whose banner BROKE; a README without it
 * is a project that never had one. Conflating the two is how a mangled release
 * line reads as agreement.
 */
export const RELEASE_BANNER_MARKER = "Latest: **v";

/** True iff the README carries the release banner marker. */
export function hasReleaseBanner(readme: string): boolean {
  return normalize(readme).includes(RELEASE_BANNER_MARKER);
}

/**
 * The CHANGELOG entry for `version`, located by VERSION MATCH — position is
 * never consulted. A leading `v` on either side is tolerated.
 *
 * The check that grades a release runs AFTER the bump, when the released
 * version is known; locating by position would grade whatever happens to sit
 * on top, which is a different release whenever the ceremony is re-run or the
 * file is edited out of order.
 */
export function findChangelogEntry(changelog: string, version: string): ChangelogEntry | null {
  const want = bareVersion(version.trim());
  return parseChangelogEntries(changelog).find((entry) => entry.version === want) ?? null;
}

const PLAN_MILESTONE_RE = new RegExp(String.raw`^milestone:\s*(${MILESTONE_TOKEN_SOURCE})\s*$`, "m");
const PLAN_FILENAME_MILESTONE_RE = new RegExp(String.raw`(?:^|/)(${MILESTONE_TOKEN_SOURCE})\.md$`);
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
      PLAN_MILESTONE_RE.exec(text)?.[1] ??
      PLAN_FILENAME_MILESTONE_RE.exec(plan.path)?.[1] ??
      null;
    if (milestone && !found.includes(milestone)) found.push(milestone);
  }
  return found.sort(compareMilestonesDescending);
}

/**
 * A TOTAL order over the union grammar, descending (AC-STE-556.9).
 *
 * `Number(token.slice(1))` — what this sort used to be — is `NaN` for every
 * `M_<key>`, and a comparator that returns `NaN` orders nothing: the list came
 * back in whatever order it was built in, silently, for exactly the ids M139
 * started minting.
 *
 * Numeric ids come first, descending by number, which is the historical
 * behaviour unchanged. Epic-keyed ids follow, descending by key. That second
 * rule is STABILITY, not seniority: the keys are opaque by contract, so no
 * ordering over them means anything — what matters is that two runs over the
 * same set answer the same way.
 */
function compareMilestonesDescending(a: string, b: string): number {
  const left = parseMilestoneToken(a);
  const right = parseMilestoneToken(b);
  if (left?.kind === "numeric" && right?.kind === "numeric") return right.number - left.number;
  if (left?.kind === "numeric") return -1;
  if (right?.kind === "numeric") return 1;
  return b.localeCompare(a);
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
 * True iff this plan carries a REAL shipped stamp. `shipped_in: null` is the
 * template sentinel for "not shipped yet", so a substring sniff for the key
 * would call an unshipped project a shipped one.
 */
function hasShippedStamp(plan: PlanText): boolean {
  const stamped = PLAN_SHIPPED_IN_RE.exec(normalize(plan.text))?.[1];
  if (stamped === undefined) return false;
  const value = stripQuotes(stamped);
  return value !== "" && value !== "null";
}

/**
 * The whole contract, as separate facts. Returns one violation per disagreeing
 * field — an empty array means the surfaces agree.
 *
 * `version` is the SUBJECT of the comparison, not a hint: it is the release
 * being graded. The `version` field grades the README banner against `version`
 * itself (so a banner left naming the PREVIOUS release is caught rather than
 * quietly selecting its own entry), and `codename`/`milestone` grade it against
 * the CHANGELOG entry and the plan record that `version` resolves to.
 *
 * Expected values derive from the CHANGELOG entry (and the plan that shipped in
 * it), never from the README, so a stale README cannot drag the other
 * expectations along with it and mask which field actually drifted.
 *
 * VACUITY IS A CONJUNCTION of three conditions — the README carries the banner
 * marker, the CHANGELOG has at least one parseable release heading, and some
 * plan carries a real shipped stamp. A project missing any one of them has not
 * adopted the surface being graded, and is reported as clean rather than failed
 * for a convention it never took up.
 */
export function checkReleaseSurfaceAgreement(
  readme: string,
  changelog: string,
  plans: PlanText[],
  version: string,
): AgreementViolation[] {
  if (!hasReleaseBanner(readme)) return [];
  if (parseChangelogEntries(changelog).length === 0) return [];
  if (!plans.some(hasShippedStamp)) return [];

  const subject = bareVersion(version.trim());
  const entry = findChangelogEntry(changelog, subject);
  if (!entry) {
    return [
      {
        field: "changelog",
        expected: subject,
        found: null,
        detail:
          `CHANGELOG.md has no \`## [${subject}] — <date> — "<Codename>"\` heading, so the ` +
          "release being graded has no entry to compare the README against.",
      },
    ];
  }

  const latest = parseReadmeLatest(readme);
  if (!latest) {
    return [
      {
        field: "latest_line",
        expected: `Latest: **v${entry.version} — "${entry.codename}"** (M<N>, …)`,
        found: null,
        detail:
          "README.md carries the release banner marker but no parseable " +
          '`Latest: **v<version> — "<Codename>"** (M<N>, …)` line; a broken line is a ' +
          "violation, not agreement.",
      },
    ];
  }

  const violations: AgreementViolation[] = [];

  if (latest.version !== subject) {
    violations.push({
      field: "version",
      expected: subject,
      found: latest.version,
      detail: `README "Latest:" names v${latest.version}; the release being graded is v${subject}.`,
    });
  }

  if (latest.codename !== entry.codename) {
    violations.push({
      field: "codename",
      expected: entry.codename,
      found: latest.codename,
      detail:
        `README "Latest:" names codename "${latest.codename}"; v${entry.version}'s CHANGELOG ` +
        `entry is "${entry.codename}". The README release-file entry rewrites only the version, ` +
        "so this field goes stale unless it is written by hand.",
    });
  }

  const milestones = findMilestonesForRelease(plans, subject);
  const canonical = milestones[0] ?? null;
  if (milestones.length === 0) {
    violations.push({
      field: "milestone",
      expected: null,
      found: latest.milestone,
      detail:
        `No plan carries \`shipped_in: v${subject}\`, so the milestone the README names ` +
        `(${latest.milestone}) cannot be confirmed against the release.`,
    });
  } else if (!milestones.includes(latest.milestone)) {
    violations.push({
      field: "milestone",
      expected: canonical,
      found: latest.milestone,
      detail:
        `README "Latest:" names ${latest.milestone}; v${subject} shipped ` +
        `${milestones.join(", ")}.`,
    });
  }

  return violations;
}

// ---------------------------------------------------------------------------
// The disk-level entry both production callers share
// ---------------------------------------------------------------------------

/**
 * True iff this project declares `changelog_ci_owned: true` in CLAUDE.md's
 * `## Docs` block.
 *
 * Read through `readDocsConfig` — the SAME reader `release_config.ts` consults
 * before it skips a `kind: changelog` entry — so the writer and the grader
 * cannot disagree about who owns the file. Re-deriving the parse here is how
 * the two halves of one ceremony drift apart.
 *
 * An absent CLAUDE.md returns all-false (a graded tree need not carry a
 * manifest), and a malformed `## Docs` value is caught rather than thrown: it
 * is real drift, but `release_config.ts` already REFUSES loudly on the same
 * literal, and a grader that threw would take probe #63 — and with it the whole
 * gate — down over one bad word. Falling back to `false` grades the project,
 * which is the loud direction, not the silent one.
 */
function changelogIsCiOwned(projectRoot: string): boolean {
  try {
    return readDocsConfig(join(projectRoot, "CLAUDE.md")).changelogCiOwned;
  } catch {
    return false;
  }
}

/**
 * The newest `## [X.Y.Z]` heading version, in the LOOSE grammar probe #63's own
 * archive walk (`readChangelogVersions`) uses — codename optional.
 *
 * Subject derivation and grading deliberately read the changelog through
 * different grammars, and this is the seam where that used to produce a false
 * accusation: `parseChangelogEntries` requires `— "<Codename>"`, so a newest
 * heading written without one was skipped and the check silently graded an
 * OLDER release, reporting a perfectly current README as naming the wrong
 * version. Deriving the subject loosely keeps both halves of the probe agreeing
 * on WHICH release is newest. Grading stays strict: a newest heading with no
 * codename then resolves to no entry and is reported as the `changelog` row it
 * really is — true, actionable, and never silent.
 */
const NEWEST_CHANGELOG_VERSION_RE = /^##\s*\[v?(\d+\.\d+\.\d+)\]/m;

export function newestChangelogVersion(changelog: string): string | undefined {
  return NEWEST_CHANGELOG_VERSION_RE.exec(normalize(changelog))?.[1];
}

/** Every `<projectRoot>/specs/plan/**\/*.md` — live plans AND the archive. */
async function readPlanTexts(projectRoot: string): Promise<PlanText[]> {
  const out: PlanText[] = [];
  const visit = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of entries) {
      const abs = join(dir, item.name);
      if (item.isDirectory()) {
        await visit(abs);
      } else if (item.isFile() && item.name.endsWith(".md")) {
        try {
          out.push({ path: relative(projectRoot, abs), text: await readFile(abs, "utf-8") });
        } catch {
          // Unreadable plan: contributes no stamp, exactly as an absent one does.
        }
      }
    }
  };
  await visit(join(projectRoot, "specs", "plan"));
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

/**
 * Grade the two release surfaces of a project on disk.
 *
 * `version` defaults to the newest CHANGELOG entry — the release the ceremony
 * has just written — but is passed explicitly by the command-line door so an
 * older release can be graded against its OWN entry.
 *
 * VACUITY CONDITION 4, checked here rather than in the pure function because it
 * is a property of the project on disk: a project whose CI owns the CHANGELOG
 * never adopted the surface being graded. `release_config.ts` skips every
 * `kind: changelog` entry for such a project, so after the bump there is no
 * `## [<newVersion>]` heading at all — grading it would return a `changelog`
 * row and exit 1, and `skills/ship-milestone` aborts before `git add`, which
 * means a CI-owned consumer could not complete a release at all.
 */
export async function runReleaseSurfaceAgreement(
  projectRoot: string,
  version?: string,
): Promise<AgreementViolation[]> {
  if (changelogIsCiOwned(projectRoot)) return [];
  const readOrEmpty = async (name: string): Promise<string> => {
    try {
      return await readFile(join(projectRoot, name), "utf-8");
    } catch {
      return "";
    }
  };
  const readme = await readOrEmpty("README.md");
  const changelog = await readOrEmpty("CHANGELOG.md");
  const subject = version ?? newestChangelogVersion(changelog);
  // No heading at all is vacuity condition 2 — the check has nothing to grade.
  if (subject === undefined) return [];
  return checkReleaseSurfaceAgreement(readme, changelog, await readPlanTexts(projectRoot), subject);
}

// ---------------------------------------------------------------------------
// Command-line front door
// ---------------------------------------------------------------------------

// STE-546. This detector was written, tested against the shipped line, and
// wired to nothing: no entry point and no production caller. Probe #63
// (`plan_ship_coherence`) now runs it, and this door lets a person — or the
// ship ceremony, AFTER the bump — run it over any tree:
//
//     bun run release_surface_agreement.ts <projectRoot> [version]
//
// Exit 0 when the surfaces agree or the check is vacuous; non-zero, with each
// violation named by field, when they disagree. Imported by the probe and by
// tests, `import.meta.main` is false and this block never runs, so the module
// stays side-effect-free at import.
if (import.meta.main) {
  const projectRoot = process.argv[2];
  if (projectRoot === undefined || projectRoot.trim() === "") {
    console.error(
      [
        "Refusing: to grade the release surfaces — no <projectRoot> was given.",
        "Remedy: re-run as `bun run release_surface_agreement.ts <projectRoot> [version]`, " +
          "where <projectRoot> is the directory holding README.md, CHANGELOG.md and specs/plan/.",
        "Context: argv=" + JSON.stringify(process.argv.slice(2)) + ", probe=release_surface_agreement",
      ].join("\n"),
    );
    process.exit(2);
  }
  const rows = await runReleaseSurfaceAgreement(projectRoot, process.argv[3]);
  for (const row of rows) console.error(`${row.field}: ${row.detail}`);
  if (rows.length > 0) process.exit(1);
}

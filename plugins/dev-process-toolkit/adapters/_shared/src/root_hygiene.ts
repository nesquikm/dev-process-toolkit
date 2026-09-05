// Root spec hygiene — two deterministic probes used by /gate-check
// (STE-59 AC-STE-59.5) to enforce the "root specs stay shape-only,
// current-only" invariant.
//
// (a) Milestone-ID leakage: scan specs/requirements.md,
//     specs/technical-spec.md, specs/testing-spec.md for `\bM\d+\b`
//     tokens. For each match, walk up to the containing heading (`##`
//     or `###`). Skip if the heading matches the allowlist
//     ("Shipped milestones" / "Archived context" / similar). For the
//     remaining matches, check `specs/plan/archive/M<N>.md` existence:
//     present ⇒ leakage (archived milestone named in live framing).
//
// (b) Version/status freshness: read `plugin.json` `version`; parse
//     `specs/requirements.md` §1 for `Latest shipped release: vX.Y.Z`
//     and `In-flight milestone: M<N>` lines. Assert the declared version
//     matches `plugin.json`; assert the in-flight milestone (if named)
//     resolves to a live `specs/plan/M<N>.md` (not the archive).
//
// Grep-based detection (not AST): AST parsing markdown is overkill for
// the pattern space, and grep produces stable line numbers. Captured in
// brainstorm deferred decision #4.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MILESTONE_TOKEN_SOURCE } from "./milestone_token";
// STE-556 AC-STE-556.3. "What codename shipped as version X" already has ONE
// reader on the release path; the probe that grades the answer consults it
// rather than parsing the CHANGELOG a second time. A private parser here is
// the drift this probe exists to catch, one layer up.
import { findChangelogEntry } from "./release_surface_agreement";

export interface LeakageHit {
  file: string;
  line: number;
  milestone: string;
  containingHeading: string;
}

export interface FreshnessDrift {
  kind:
    | "version-mismatch"
    | "codename-mismatch"
    | "in-flight-archived"
    | "in-flight-missing-plan"
    | "version-unparseable"
    | "overview-missing";
  file: string;
  line: number | null;
  message: string;
}

export interface RootHygieneReport {
  leakage: LeakageHit[];
  freshness: FreshnessDrift[];
  /**
   * Set when probe #9b (version-freshness vs. plugin.json) cannot run
   * because the host project has no plugin manifest at the expected path
   * (i.e., this is an end-user project, not a Claude Code plugin). Callers
   * render this as an `n/a` row in the gate report rather than a failure.
   */
  versionFreshnessSkipped?: { reason: string };
}

const ROOT_SPEC_FILES = ["requirements.md", "technical-spec.md", "testing-spec.md"];
// Captures the heading title; strips an optional trailing `{#anchor}` id.
const HEADING_LINE = /^#{1,4}\s+(.+?)(?:\s*\{#[^}]*\})?\s*$/;

function milestoneTokenMatches(line: string): string[] {
  // Fresh per-call regex — avoids the shared-lastIndex hazard of a
  // module-scope /g instance if this function is ever called re-entrantly.
  // Union grammar: numeric M<N> and Epic-keyed M_<epic-key> refs both count.
  const re = new RegExp(String.raw`\b(?:${MILESTONE_TOKEN_SOURCE})\b`, "g");
  const hits: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(line)) !== null) hits.push(match[0]);
  return hits;
}

// Allowlist: headings whose descendants may legitimately name archived
// milestones. Match case-insensitively; anchor at the heading title text.
const ALLOWED_HEADING_PATTERNS: RegExp[] = [
  /^shipped milestones\b/i,
  /^archived context\b/i,
  /^shipped releases\b/i,
  /^release notes\b/i,
  /^release history\b/i,
];

function isAllowedHeading(title: string): boolean {
  return ALLOWED_HEADING_PATTERNS.some((re) => re.test(title.trim()));
}

/**
 * Walk backwards from `lineIdx` to find the nearest `##` or `###`
 * heading. Returns the heading title text, or "" if the file has no
 * heading before that line.
 */
function findContainingHeading(lines: string[], lineIdx: number): string {
  for (let i = lineIdx; i >= 0; i--) {
    const m = HEADING_LINE.exec(lines[i]!);
    if (m) return m[1]!.trim();
  }
  return "";
}

export function findMilestoneLeakage(specsDir: string): LeakageHit[] {
  const archiveDir = join(specsDir, "plan", "archive");
  const hits: LeakageHit[] = [];

  for (const name of ROOT_SPEC_FILES) {
    const path = join(specsDir, name);
    if (!existsSync(path)) continue;
    const body = readFileSync(path, "utf8");
    const lines = body.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      for (const milestone of milestoneTokenMatches(line)) {
        const heading = findContainingHeading(lines, i);
        if (isAllowedHeading(heading)) continue;

        const archivedPlan = join(archiveDir, `${milestone}.md`);
        if (!existsSync(archivedPlan)) continue;

        hits.push({ file: name, line: i + 1, milestone, containingHeading: heading });
      }
    }
  }

  return hits;
}

export function findVersionFreshnessDrift(
  specsDir: string,
  pluginJsonPath: string,
  // STE-556. Optional and defaulted from the specs directory's parent, so every
  // caller that passes nothing behaves exactly as it did before this argument
  // existed. Named explicitly by the tests, which grade fixture trees.
  changelogPath: string = join(specsDir, "..", "CHANGELOG.md"),
): FreshnessDrift[] {
  const drifts: FreshnessDrift[] = [];
  const reqPath = join(specsDir, "requirements.md");

  if (!existsSync(reqPath)) {
    drifts.push({
      kind: "overview-missing",
      file: "requirements.md",
      line: null,
      message: "requirements.md not found",
    });
    return drifts;
  }

  let pluginVersion = "";
  if (existsSync(pluginJsonPath)) {
    try {
      const pj = JSON.parse(readFileSync(pluginJsonPath, "utf8")) as Record<string, unknown>;
      const v = pj["version"];
      if (typeof v === "string") pluginVersion = v;
    } catch {
      // fall through — treat as unparseable
    }
  }

  const body = readFileSync(reqPath, "utf8");
  const lines = body.split("\n");

  // Isolate §1 Overview window: from "## 1. Overview" (or "## 1 Overview"
  // or "# Overview") through the next level-2 heading.
  const overviewStart = lines.findIndex((l) => /^##\s+1\.?\s+Overview\b/i.test(l));
  if (overviewStart < 0) {
    drifts.push({
      kind: "overview-missing",
      file: "requirements.md",
      line: null,
      message: "§1 Overview heading not found in requirements.md",
    });
    return drifts;
  }
  let overviewEnd = lines.length;
  for (let i = overviewStart + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i]!)) {
      overviewEnd = i;
      break;
    }
  }

  // Version check: "Latest shipped release: ... vX.Y.Z ..."
  //
  // STE-556. A SECOND named group, on the same scan of the same line. The
  // shipped matcher captured the version alone and swallowed the codename
  // inside `[^\n]*`; measured at HEAD, rewriting the line's codename to
  // `("CompletelyWrongCodename")` produced drifts byte-identical to the
  // unmutated run — `[]` both times. Combined with the codename having no
  // writer either (STE-554), the field was maintained by nothing and checked
  // by nothing.
  //
  // The codename group is OPTIONAL: a consumer project whose line reads
  // `Latest shipped release: v1.0.0` never adopted a codenamed banner, and
  // grading it for a convention it does not use is a false accusation, not a
  // catch.
  // The codename must be QUOTED to be read as one. An unquoted parenthetical
  // is left alone deliberately — `v1.0.0 (2026-01-01)` is a date, and reading
  // it as a codename would red a project that never had one. The version half
  // of the pattern is byte-identical to the shipped one, GREEDY `[^\n]*`
  // included: making it lazy would change which version a line naming two
  // resolves to, which is not this FR's business.
  const versionRe =
    /Latest shipped release:[^\n]*v(?<version>\d+\.\d+\.\d+)(?:[^\n]*?\(\s*"(?<codename>[^"\n]+)"\s*\))?/;
  let declaredVersion = "";
  let declaredCodename = "";
  let declaredVersionLine = -1;
  for (let i = overviewStart; i < overviewEnd; i++) {
    const m = versionRe.exec(lines[i]!);
    if (m?.groups) {
      declaredVersion = m.groups.version!;
      declaredCodename = m.groups.codename ?? "";
      declaredVersionLine = i + 1;
      break;
    }
  }

  if (declaredVersion === "") {
    drifts.push({
      kind: "version-unparseable",
      file: "requirements.md",
      line: null,
      message: `§1 Overview has no \`Latest shipped release: vX.Y.Z\` line`,
    });
  } else if (pluginVersion && declaredVersion !== pluginVersion) {
    drifts.push({
      kind: "version-mismatch",
      file: "requirements.md",
      line: declaredVersionLine,
      message: `Declared version v${declaredVersion} does not match plugin.json v${pluginVersion}`,
    });
  }

  // Codename check. Vacuous on two independent conditions, each of which means
  // the surface being graded does not exist here: the line names no codename,
  // or the CHANGELOG carries no entry for the version the line declares. The
  // expected value comes from the CHANGELOG, never from the line itself — a
  // stale line must not supply its own expectation.
  if (declaredVersion !== "" && declaredCodename !== "") {
    let changelog = "";
    if (existsSync(changelogPath)) {
      try {
        changelog = readFileSync(changelogPath, "utf8");
      } catch {
        // Unreadable CHANGELOG contributes no expectation, exactly as an
        // absent one does — the check goes vacuous rather than accusing.
      }
    }
    const entry = changelog === "" ? null : findChangelogEntry(changelog, declaredVersion);
    if (entry !== null && entry.codename !== declaredCodename) {
      drifts.push({
        kind: "codename-mismatch",
        file: "requirements.md",
        line: declaredVersionLine,
        message:
          `Declared codename "${declaredCodename}" does not match the CHANGELOG entry for ` +
          `v${declaredVersion}, which is "${entry.codename}"`,
      });
    }
  }

  // In-flight milestone check: "In-flight milestone: M<N>" (plain text or
  // bolded). Optional — absence is legal.
  //
  // STE-556. The shipped matcher was a private `\bM(\d+)\b` — inside a module
  // already importing the shared union grammar for its OTHER scan, which is
  // how the audit that greps for a `milestone_token` reference passed while a
  // private copy sat two hundred lines below the import. Under M139's
  // tracker-first scheme a live milestone is `M_<key>`, and the private copy
  // matched nothing on such a line: the check did not fail, it silently
  // declined to run on a claim it could not read.
  const inFlightRe = new RegExp(String.raw`In-flight milestone:[^\n]*\b(${MILESTONE_TOKEN_SOURCE})\b`);
  for (let i = overviewStart; i < overviewEnd; i++) {
    const m = inFlightRe.exec(lines[i]!);
    if (!m) continue;
    const milestoneId = m[1]!;
    const livePlan = join(specsDir, "plan", `${milestoneId}.md`);
    const archivedPlan = join(specsDir, "plan", "archive", `${milestoneId}.md`);
    if (!existsSync(livePlan)) {
      if (existsSync(archivedPlan)) {
        drifts.push({
          kind: "in-flight-archived",
          file: "requirements.md",
          line: i + 1,
          message: `In-flight milestone ${milestoneId} is archived (found at specs/plan/archive/${milestoneId}.md)`,
        });
      } else {
        drifts.push({
          kind: "in-flight-missing-plan",
          file: "requirements.md",
          line: i + 1,
          message: `In-flight milestone ${milestoneId} has no live plan at specs/plan/${milestoneId}.md`,
        });
      }
    }
    break; // One in-flight claim per overview.
  }

  return drifts;
}

export function runRootHygiene(
  specsDir: string,
  pluginJsonPath: string,
  // Threaded through unchanged; omitting it keeps today's behaviour exactly.
  changelogPath?: string,
): RootHygieneReport {
  const leakage = findMilestoneLeakage(specsDir);
  if (!existsSync(pluginJsonPath)) {
    return {
      leakage,
      freshness: [],
      versionFreshnessSkipped: {
        reason: "no plugin manifest in this project — probe skipped",
      },
    };
  }
  return {
    leakage,
    freshness:
      changelogPath === undefined
        ? findVersionFreshnessDrift(specsDir, pluginJsonPath)
        : findVersionFreshnessDrift(specsDir, pluginJsonPath, changelogPath),
  };
}

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

export interface LeakageHit {
  file: string;
  line: number;
  milestone: string;
  containingHeading: string;
}

export interface FreshnessDrift {
  kind:
    | "version-mismatch"
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
}

const ROOT_SPEC_FILES = ["requirements.md", "technical-spec.md", "testing-spec.md"];
// Captures the heading title; strips an optional trailing `{#anchor}` id.
const HEADING_LINE = /^#{1,4}\s+(.+?)(?:\s*\{#[^}]*\})?\s*$/;

function milestoneTokenMatches(line: string): string[] {
  // Fresh per-call regex — avoids the shared-lastIndex hazard of a
  // module-scope /g instance if this function is ever called re-entrantly.
  const re = /\bM\d+\b/g;
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

export function findVersionFreshnessDrift(specsDir: string, pluginJsonPath: string): FreshnessDrift[] {
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
  const versionRe = /Latest shipped release:[^\n]*v(\d+\.\d+\.\d+)/;
  let declaredVersion = "";
  let declaredVersionLine = -1;
  for (let i = overviewStart; i < overviewEnd; i++) {
    const m = versionRe.exec(lines[i]!);
    if (m) {
      declaredVersion = m[1]!;
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

  // In-flight milestone check: "In-flight milestone: M<N>" (plain text or
  // bolded). Optional — absence is legal.
  const inFlightRe = /In-flight milestone:[^\n]*\bM(\d+)\b/;
  for (let i = overviewStart; i < overviewEnd; i++) {
    const m = inFlightRe.exec(lines[i]!);
    if (!m) continue;
    const milestoneNum = m[1]!;
    const milestoneId = `M${milestoneNum}`;
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

export function runRootHygiene(specsDir: string, pluginJsonPath: string): RootHygieneReport {
  return {
    leakage: findMilestoneLeakage(specsDir),
    freshness: findVersionFreshnessDrift(specsDir, pluginJsonPath),
  };
}

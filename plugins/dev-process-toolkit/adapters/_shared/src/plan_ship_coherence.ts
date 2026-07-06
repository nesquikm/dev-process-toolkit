// plan_ship_coherence — /gate-check probe (STE-369).
//
// Invariant (AC-STE-369.1): every `specs/plan/archive/M<N>.md` carrying a
// `shipped_in: v<X.Y.Z>` frontmatter stamp must resolve to a `## [X.Y.Z]`
// heading in CHANGELOG.md. A missing heading or a malformed stamp value is
// an ERROR-severity violation (corrupt stamp) in the NFR-10 canonical shape
// naming the plan, the stamp value, and the remedy.
//
// Scope guard: archive dir ONLY — live plans under `specs/plan/` are exempt
// by construction.
//
// Violation shape mirrors probe #16 (`archive_plan_status.ts`): `note` is
// `<repo-relative-file>:<line> — <reason>`, `message` is the multi-line
// canonical shape with `Remedy:` and `Context:` sub-lines.

import { readdir, readFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";

const PROBE = "plan_ship_coherence";

/**
 * Canonical post-merge ship ceremony recipe. Shared verbatim with
 * docs/ship-milestone-reference.md (STE-370) — edit here, mirror there.
 */
export const SHIP_CEREMONY_RECIPE = [
  "1. /spec-archive M<N> — only when FRs are still active (skip if already archived)",
  "2. /ship-milestone M<N> — bump the release files, regenerate docs, release commit",
  "3. /pr — push the branch and open the pull request",
].join("\n");

export interface PlanShipCoherenceViolation {
  file: string;
  line: number;
  reason: string;
  note: string; // `file:line — reason` per STE-82
  message: string; // NFR-10 canonical multi-line shape
}

export interface PlanShipCoherenceReport {
  violations: PlanShipCoherenceViolation[];
  notes: string[];
}

const STAMP_RE = /^v(\d+\.\d+\.\d+)$/;

interface FieldHit {
  present: boolean;
  value: string;
  line: number; // 1-based line number in the file
}

/** Scan the frontmatter block for a scalar key, keeping its line number. */
function scanFrontmatterField(content: string, key: string): FieldHit {
  const out: FieldHit = { present: false, value: "", line: 0 };
  if (!content.startsWith("---\n")) return out;
  const closeIdx = content.indexOf("\n---", 4);
  if (closeIdx < 0) return out;
  const fmLines = content.slice(4, closeIdx).split("\n");
  for (let i = 0; i < fmLines.length; i++) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(fmLines[i]!);
    if (!m || m[1] !== key) continue;
    // +2: one for the leading `---\n`, one for 1-based line numbering.
    out.present = true;
    out.value = (m[2] ?? "").trim();
    out.line = i + 2;
  }
  return out;
}

/** Build the full violation record: `note` per STE-82, `message` per NFR-10. */
function makeViolation(
  file: string,
  rel: string,
  line: number,
  reason: string,
  remedy: string,
  stamp: string,
): PlanShipCoherenceViolation {
  return {
    file,
    line,
    reason,
    note: `${rel}:${line} — ${reason}`,
    message: [
      `${PROBE}: ${reason}`,
      `Remedy: ${remedy}`,
      `Context: file=${rel}, shipped_in=${stamp}, probe=${PROBE}`,
    ].join("\n"),
  };
}

async function listArchivePlans(projectRoot: string): Promise<string[]> {
  const dir = join(projectRoot, "specs", "plan", "archive");
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && /^M\d+\.md$/.test(e.name))
      .map((e) => join(dir, e.name))
      .sort();
  } catch {
    return [];
  }
}

/** Collect the set of `## [X.Y.Z]` heading versions in CHANGELOG.md. */
async function readChangelogVersions(projectRoot: string): Promise<Set<string>> {
  const versions = new Set<string>();
  let content: string;
  try {
    content = await readFile(join(projectRoot, "CHANGELOG.md"), "utf-8");
  } catch {
    return versions;
  }
  for (const line of content.split("\n")) {
    const m = /^##\s*\[(\d+\.\d+\.\d+)\]/.exec(line);
    if (m) versions.add(m[1]!);
  }
  return versions;
}

/**
 * Scan every `specs/plan/archive/M*.md` under `projectRoot` and check each
 * `shipped_in` stamp against the CHANGELOG.md release headings. Pure
 * function — no side effects, no writes.
 *
 * Call site: `/gate-check` conformance probes + the STE-369 integration
 * test at `tests/gate-check-plan-ship-coherence.test.ts`.
 */
export async function runPlanShipCoherenceProbe(
  projectRoot: string,
): Promise<PlanShipCoherenceReport> {
  const files = await listArchivePlans(projectRoot);
  const changelogVersions = await readChangelogVersions(projectRoot);
  const violations: PlanShipCoherenceViolation[] = [];
  const notes: string[] = [];
  const parked: string[] = [];

  for (const file of files) {
    let content: string;
    try {
      content = await readFile(file, "utf-8");
    } catch {
      continue;
    }
    const rel = relative(projectRoot, file);
    const shippedIn = scanFrontmatterField(content, "shipped_in");
    if (!shippedIn.present) {
      const shipState = scanFrontmatterField(content, "ship_state");
      if (shipState.present && shipState.value === "parked") {
        // AC-STE-369.3 — parked plans pass, surfaced via a NOTES row so
        // parking never becomes a silent get-to-green stamp.
        // listArchivePlans filtered on /^M\d+\.md$/, so basename is the milestone.
        parked.push(basename(file, ".md"));
        continue;
      }
      // AC-STE-369.2 — neither stamped nor parked: unshipped debt.
      violations.push(
        makeViolation(
          file,
          rel,
          1,
          `archived plan ${rel} has neither a shipped_in stamp nor ship_state: parked (unshipped debt)`,
          `run the post-merge ship ceremony:\n${SHIP_CEREMONY_RECIPE}`,
          "<absent>",
        ),
      );
      continue;
    }

    const stampLine = shippedIn.line || 1;
    const stampMatch = STAMP_RE.exec(shippedIn.value);
    if (!stampMatch) {
      violations.push(
        makeViolation(
          file,
          rel,
          stampLine,
          `malformed shipped_in stamp in ${rel}: expected v<X.Y.Z>, observed: ${shippedIn.value} (corrupt stamp)`,
          `rewrite the shipped_in stamp in ${rel} as v<X.Y.Z> matching the ` +
            `\`## [X.Y.Z]\` CHANGELOG.md heading of the release that shipped this milestone.`,
          shippedIn.value,
        ),
      );
      continue;
    }

    const version = stampMatch[1]!;
    if (!changelogVersions.has(version)) {
      violations.push(
        makeViolation(
          file,
          rel,
          stampLine,
          `shipped_in stamp ${shippedIn.value} in ${rel} has no matching ## [${version}] heading in CHANGELOG.md (corrupt stamp)`,
          `fix the shipped_in stamp in ${rel} to the version of the CHANGELOG.md ` +
            `release heading that actually shipped this milestone, or ship the release so the \`## [${version}]\` heading exists.`,
          shippedIn.value,
        ),
      );
    }
  }

  if (parked.length > 0) {
    // Single GATE PASSED WITH NOTES row enumerating every parked milestone.
    parked.sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
    notes.push(`parked milestones: ${parked.join(", ")}`);
  }

  return { violations, notes };
}

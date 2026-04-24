// archive_plan_status — /gate-check probe #16 (STE-92 AC-STE-92.4/.5/.7).
//
// Invariant: every `specs/plan/archive/M*.md` file MUST carry frontmatter
//   - status: archived
//   - archived_at: <non-null ISO-8601 string>
//
// Defense-in-depth (H5 iteration-5 was downgraded to cosmetic — no live
// code path consumes archived plan status today). The probe ships with
// the backfill that flips all 18 drifted plans, so it starts green.

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { parseFrontmatter } from "./frontmatter";

const CANONICAL_STATUS = "archived";

export interface ArchivePlanStatusViolation {
  file: string;
  line: number;
  reason: string;
  note: string; // `file:line — reason` per STE-82
  message: string; // NFR-10 canonical multi-line shape
}

export interface ArchivePlanStatusReport {
  violations: ArchivePlanStatusViolation[];
}

interface FieldScan {
  status: { present: boolean; value: string; line: number };
  archivedAt: { present: boolean; value: string; line: number };
}

function scanFrontmatterLines(content: string): FieldScan {
  const out: FieldScan = {
    status: { present: false, value: "", line: 0 },
    archivedAt: { present: false, value: "", line: 0 },
  };
  if (!content.startsWith("---\n")) return out;
  const closeIdx = content.indexOf("\n---", 4);
  if (closeIdx < 0) return out;
  const fmText = content.slice(4, closeIdx);
  const fmLines = fmText.split("\n");
  for (let i = 0; i < fmLines.length; i++) {
    const line = fmLines[i]!;
    const m = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1]!;
    const value = (m[2] ?? "").trim();
    // +2: one for the leading `---\n`, one for 1-based line numbering.
    const lineNo = i + 2;
    if (key === "status") {
      out.status = { present: true, value, line: lineNo };
    } else if (key === "archived_at") {
      out.archivedAt = { present: true, value, line: lineNo };
    }
  }
  return out;
}

function buildMessage(reason: string, file: string, projectRoot: string): string {
  const rel = relative(projectRoot, file);
  return [
    `archive_plan_status: ${reason}`,
    `Remedy: set frontmatter to status: ${CANONICAL_STATUS} with a non-null archived_at ISO-8601 timestamp in ${rel}. ` +
      `Use \`git log -1 --format=%cI -- ${rel}\` for the canonical timestamp.`,
    `Context: file=${rel}, expected_status=${CANONICAL_STATUS}, probe=archive_plan_status`,
  ].join("\n");
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

/**
 * Scan every `specs/plan/archive/M*.md` under `projectRoot` and return the
 * list of violations. Pure function — no side effects, no writes.
 *
 * Call site: `/gate-check` v2 conformance probes (probe #16) + the STE-82
 * integration test at `tests/gate-check-archive-plan-status.test.ts`.
 */
export async function runArchivePlanStatusProbe(
  projectRoot: string,
): Promise<ArchivePlanStatusReport> {
  const files = await listArchivePlans(projectRoot);
  const violations: ArchivePlanStatusViolation[] = [];

  for (const file of files) {
    let content: string;
    try {
      content = await readFile(file, "utf-8");
    } catch {
      continue;
    }
    // parseFrontmatter is the canonical authority for whether the YAML
    // block is well-formed; we use scanFrontmatterLines for the line
    // numbers the note shape requires.
    let fm: Record<string, unknown>;
    try {
      fm = parseFrontmatter(content);
    } catch {
      const reason = `frontmatter could not be parsed`;
      violations.push({
        file,
        line: 1,
        reason,
        note: `${relative(projectRoot, file)}:1 — ${reason}`,
        message: buildMessage(reason, file, projectRoot),
      });
      continue;
    }
    const scan = scanFrontmatterLines(content);
    const status = fm["status"];
    const archivedAt = fm["archived_at"];

    // Status check
    if (status !== CANONICAL_STATUS) {
      const observed = status === undefined ? "<missing>" : String(status);
      const reason = `expected status: ${CANONICAL_STATUS}, observed status: ${observed}`;
      violations.push({
        file,
        line: scan.status.line || 1,
        reason,
        note: `${relative(projectRoot, file)}:${scan.status.line || 1} — ${reason}`,
        message: buildMessage(reason, file, projectRoot),
      });
      continue; // one violation per file is enough to point operator at it
    }

    // archived_at check: must be a non-empty string. parseFrontmatter
    // returns `{}` for the bare-key form (`archived_at:` with no value),
    // and `null` for the literal `null`. Both are violations alongside the
    // `undefined` (key absent entirely) case.
    const isEmptyObject =
      typeof archivedAt === "object" &&
      archivedAt !== null &&
      Object.keys(archivedAt).length === 0;
    const missing =
      archivedAt === undefined ||
      archivedAt === null ||
      archivedAt === "" ||
      isEmptyObject;
    if (missing) {
      const observed =
        archivedAt === undefined
          ? "<missing>"
          : isEmptyObject
            ? "<bare-key>"
            : String(archivedAt);
      const reason = `archived_at must be a non-null ISO-8601 string, observed: ${observed}`;
      violations.push({
        file,
        line: scan.archivedAt.line || scan.status.line || 1,
        reason,
        note: `${relative(projectRoot, file)}:${scan.archivedAt.line || scan.status.line || 1} — ${reason}`,
        message: buildMessage(reason, file, projectRoot),
      });
    }
  }

  return { violations };
}

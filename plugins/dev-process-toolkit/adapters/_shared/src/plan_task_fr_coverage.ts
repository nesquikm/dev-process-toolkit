// plan_task_fr_coverage — STE-201 AC-STE-201.4 helper + /gate-check probe.
//
// For each active milestone plan (`specs/plan/M*.md`, archive excluded),
// every `**Tasks:**`-block bullet should resolve to an FR row in the
// plan's FR table OR be marked `[deferred]`. A task with no backing FR
// row surfaces as ADVISORY drift (warn-only, never **GATE FAILED**).
//
// Heuristic: a task bullet matches an FR row when (a) the task carries
// an explicit inline link `- [ ] foo — STE-NNN` (the explicit link wins),
// OR (b) the bullet's leading verb-phrase appears in the FR row title
// (case-insensitive substring). The probe only runs against active
// plans; legacy archived plans are not retroactively flagged (per the
// AC.4 prose).

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { PLAN_FILENAME_RE } from "./milestone_token";

export interface PlanTaskFrCoverageViolation {
  file: string;
  line: number;
  task: string;
  reason: string;
  note: string;
}

export interface PlanTaskFrCoverageReport {
  violations: PlanTaskFrCoverageViolation[];
}

/** Strict task-bullet regex: marker is anything inside the brackets,
 *  surrounded by whitespace per Markdown task-list syntax. Matches
 *  `- [ ]`, `- [x]`, `- [deferred]`, `- [foo]` … the marker is the
 *  capture group; downstream logic categorises it. */
const TASK_LINE_RE = /^\s*-\s*\[(?<marker>[^\]]*)\]\s+(?<body>.+)$/;
/** Inline FR-link suffix: `— STE-NNN` (em-dash or hyphen, then ID). */
const INLINE_FR_LINK_RE = /[—-]\s+([A-Z]+-\d+)\s*$/;

interface FrRow {
  trackerId: string | null;
  title: string;
}

/** Parse `**Tasks:**` block lines from a plan body. Returns a list of
 *  unchecked, non-deferred bullets with line numbers. */
function parseUncheckedTasks(content: string): { line: number; body: string; explicitFr: string | null }[] {
  const out: { line: number; body: string; explicitFr: string | null }[] = [];
  const lines = content.split("\n");
  let inTasks = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\*\*Tasks:\*\*/.test(line)) {
      inTasks = true;
      continue;
    }
    if (inTasks && /^##\s/.test(line)) {
      inTasks = false;
      continue;
    }
    if (inTasks && /^\*\*[A-Z]/.test(line)) {
      // Next bold-section heading inside the milestone (`**Tests:**`,
      // `**Acceptance Criteria:**`, …) ends the Tasks block.
      inTasks = false;
      continue;
    }
    if (!inTasks) continue;
    const m = TASK_LINE_RE.exec(line);
    if (!m) continue;
    const marker = (m.groups?.marker ?? "").trim().toLowerCase();
    const body = (m.groups?.body ?? "").trim();
    if (marker === "x" || marker === "deferred") continue;
    // Only canonical `[ ]` (empty marker) is treated as "unchecked and
    // requires backing FR." Unknown markers (`[~]`, `[partial]`, etc.)
    // are skipped here — they're operator-defined sentinels the probe
    // doesn't understand. If a project introduces a new marker that
    // SHOULD count as unchecked, add explicit handling above.
    if (marker !== "") continue;
    const explicitFr = INLINE_FR_LINK_RE.exec(body)?.[1] ?? null;
    out.push({ line: i + 1, body, explicitFr });
  }
  return out;
}

/** Parse the FR table — every row of shape
 *  `| <tracker-id-or-placeholder> | <Title> | <link> |`. */
function parseFrRows(content: string): FrRow[] {
  const rows: FrRow[] = [];
  for (const line of content.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    if (cells.length < 4) continue;
    const tracker = cells[1] ?? "";
    const title = cells[2] ?? "";
    if (tracker === "" || title === "") continue;
    if (/^[-:]+$/.test(tracker)) continue; // header-divider row
    if (tracker.toLowerCase() === "fr") continue; // header
    rows.push({
      trackerId: /^[A-Z]+-\d+$/.test(tracker) ? tracker : null,
      title,
    });
  }
  return rows;
}

/** Decide whether a task body matches an FR row. Explicit inline link
 *  (`— STE-NNN`) wins; otherwise case-insensitive substring of the
 *  task's leading verb-phrase against the FR title. */
function taskMatchesAnyRow(body: string, explicitFr: string | null, rows: FrRow[]): boolean {
  if (explicitFr) {
    return rows.some((r) => r.trackerId === explicitFr);
  }
  const verbPhrase = body.split(/[—-]/)[0]!.trim().toLowerCase();
  if (verbPhrase.length === 0) return false;
  return rows.some((r) => r.title.toLowerCase().includes(verbPhrase));
}

async function listActivePlans(projectRoot: string): Promise<string[]> {
  const dir = join(projectRoot, "specs", "plan");
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && PLAN_FILENAME_RE.test(e.name))
      .map((e) => join(dir, e.name))
      .sort();
  } catch {
    return [];
  }
}

export async function runPlanTaskFrCoverageProbe(
  projectRoot: string,
): Promise<PlanTaskFrCoverageReport> {
  const files = await listActivePlans(projectRoot);
  const violations: PlanTaskFrCoverageViolation[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = await readFile(file, "utf-8");
    } catch {
      continue;
    }
    const rows = parseFrRows(content);
    const tasks = parseUncheckedTasks(content);
    for (const t of tasks) {
      if (taskMatchesAnyRow(t.body, t.explicitFr, rows)) continue;
      const rel = relative(projectRoot, file);
      const reason = `unchecked task has no backing FR row and no [deferred] marker: ${t.body}`;
      violations.push({
        file,
        line: t.line,
        task: t.body,
        reason,
        note: `${rel}:${t.line} — ${reason}`,
      });
    }
  }
  return { violations };
}

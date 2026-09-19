// task_tracking_workspace_binding_present — /gate-check probe (#25, STE-117 AC-STE-117.8).
//
// In tracker mode, the `## Task Tracking` block must carry a populated
// `### Linear` / `### Jira` sub-section identifying the workspace binding
// (Linear team + project, Jira project). Closes the silent-landing trap
// from M30 spec-write where STE-115/116 were `mcp__linear__save_issue`'d
// without `project`, landing outside the user's expected project board.
//
// Vacuous on:
//   - CLAUDE.md absent;
//   - `## Task Tracking` section absent (mode-none canonical form);
//   - `mode: none` explicit.
//
// Required:
//   - Linear: `team:` AND `project:` non-empty in `### Linear`;
//   - Jira: `project:` non-empty in `### Jira` (team is N/A).
//
// Legs past the required keys:
//   STE-603 — when the sub-section declares a `repo_tag`:
//     (a) a reader refusal is a violation carrying the reader's own text;
//     (b) the shared-container stop paragraph absent, present twice, or not
//         byte-equal to `renderSharedTrackerSentinel` for the declared tag/floor;
//     (c) the running toolkit version below `min_dpt_version`.
//   A stop paragraph with no declaration is also a violation. With neither a
//   declaration nor a paragraph, those legs add nothing.
//   STE-612 — (d) the key-prefix leg, under `mode: jira` only: each active FR
//     whose tracker key's project prefix is not the bound project, and each
//     active Epic-keyed plan outside the bound project's Epic-token prefix
//     (`epicTokenPrefix`, the STE-611 forward-sanitization expression), is a
//     violation naming the repoint command. Under Linear, or with no bound
//     project, the leg does not run and the report lists it in `skipped` —
//     never counted as passed. The repoint command's row 7 applies the same
//     two exported checks (`foreignJiraKeyProject`, `epicTokenOutside`).

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { checkVersionFloor, nfr10Message, runningDptVersion } from "./dpt_version";
import { parseFrontmatter } from "./frontmatter";
import { oneLine } from "./tracker_receipts";
import { milestoneIdFromEpicKey, PLAN_FILENAME_RE, parseMilestoneToken } from "./milestone_token";
import { renderSharedTrackerSentinel, SHARED_TRACKER_MARKER } from "./setup/tracker_binding_write";
import {
  locateSubsection,
  readWorkspaceBinding,
  type WorkspaceAdapterKey,
  type WorkspaceBinding,
} from "./workspace_binding";

export interface TaskTrackingWorkspaceBindingViolation {
  file: string;
  line: number;
  reason: string;
  note: string;
  message: string;
}

export interface TaskTrackingWorkspaceBindingReport {
  violations: TaskTrackingWorkspaceBindingViolation[];
  /** Legs that did not run here — listed so a skip is never read as a pass. */
  skipped?: string[];
}

const SECTION_HEADING = "## Task Tracking";

interface ResolvedMode {
  mode: string;
  modeLine: number;
  sectionLine: number;
}

function resolveMode(content: string): ResolvedMode | null {
  const lines = content.split("\n");
  const sectionLine = lines.findIndex((l) => l === SECTION_HEADING);
  if (sectionLine < 0) return null;
  let endLine = lines.length;
  for (let i = sectionLine + 1; i < lines.length; i++) {
    // Aligned with task_tracking_canonical_keys.ts and migrate-* scripts.
    if (/^#{1,2}\s/.test(lines[i]!)) {
      endLine = i;
      break;
    }
  }
  for (let i = sectionLine + 1; i < endLine; i++) {
    const m = /^mode:\s*(\S+)\s*$/.exec(lines[i]!);
    if (m) return { mode: m[1]!, modeLine: i + 1, sectionLine: sectionLine + 1 };
  }
  return { mode: "", modeLine: sectionLine + 1, sectionLine: sectionLine + 1 };
}

function adapterKeyForMode(mode: string): WorkspaceAdapterKey | null {
  if (mode === "linear") return "linear";
  if (mode === "jira") return "jira";
  return null;
}

function buildMessage(reason: string, file: string, mode: string): string {
  return [
    `task_tracking_workspace_binding_present: ${reason}`,
    `Remedy: under ## Task Tracking, add a \`### ${mode === "linear" ? "Linear" : "Jira"}\` sub-section ` +
      `with required keys (Linear: team + project; Jira: project). Run the migration helper at ` +
      `plugins/dev-process-toolkit/scripts/migrate-task-tracking-add-workspace.ts to generate a diff. ` +
      `See plugins/dev-process-toolkit/docs/patterns.md § Schema L Workspace binding sub-sections.`,
    `Context: file=${file}, mode=${mode}, probe=task_tracking_workspace_binding_present`,
  ].join("\n");
}

const WRITER = "plugins/dev-process-toolkit/adapters/_shared/src/setup/tracker_binding_write.ts";

function buildSharedMessage(leg: string, reason: string, remedy: string, file: string, mode: string): string {
  return nfr10Message(
    `task_tracking_workspace_binding_present: ${reason}`,
    remedy,
    `file=${file}, mode=${mode}, leg=${leg}, probe=task_tracking_workspace_binding_present`,
  );
}

/** Each stop paragraph in the sub-section: the marker line through its contiguous `>` lines. */
function stopParagraphs(sub: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < sub.length; i++) {
    if (sub[i] !== SHARED_TRACKER_MARKER) continue;
    let end = i + 1;
    while (end < sub.length && sub[end]!.startsWith(">") && sub[end] !== SHARED_TRACKER_MARKER) end++;
    out.push(sub.slice(i, end).join("\n"));
    i = end - 1;
  }
  return out;
}

export async function runTaskTrackingWorkspaceBindingPresentProbe(
  projectRoot: string,
): Promise<TaskTrackingWorkspaceBindingReport> {
  const claudeMd = join(projectRoot, "CLAUDE.md");
  if (!existsSync(claudeMd)) return { violations: [] };
  const content = readFileSync(claudeMd, "utf-8");
  const resolved = resolveMode(content);
  if (!resolved) return { violations: [] };
  if (resolved.mode === "" || resolved.mode === "none") return { violations: [] };

  const adapterKey = adapterKeyForMode(resolved.mode);
  if (adapterKey === null) {
    // Custom adapter — out of scope for this probe (no canonical sub-section
    // shape defined for arbitrary trackers). Vacuous pass.
    return { violations: [] };
  }

  const rel = relative(projectRoot, claudeMd);
  const subTitle = `### ${adapterKey === "linear" ? "Linear" : "Jira"}`;
  const lines = content.split("\n");

  const subPresent = lines.some((l) => l === subTitle);
  if (!subPresent) {
    const reason = `tracker mode "${resolved.mode}" requires a ${subTitle} sub-section under ## Task Tracking — sub-section is absent`;
    return {
      violations: [
        {
          file: claudeMd,
          line: resolved.sectionLine,
          reason,
          note: `${rel}:${resolved.sectionLine} — ${reason}`,
          message: buildMessage(reason, rel, resolved.mode),
        },
      ],
    };
  }

  // Find the line of the sub-section heading for diagnostic positioning.
  const headingLineIdx = lines.findIndex((l) => l === subTitle);
  const lineNo = headingLineIdx >= 0 ? headingLineIdx + 1 : resolved.sectionLine;
  const violation = (reason: string, message: string): TaskTrackingWorkspaceBindingViolation => ({
    file: claudeMd,
    line: lineNo,
    reason,
    note: `${rel}:${lineNo} — ${reason}`,
    message,
  });

  // Leg (a) — the reader's refusal, in the reader's own words.
  let binding: WorkspaceBinding;
  try {
    binding = readWorkspaceBinding(claudeMd, adapterKey);
  } catch (e) {
    const readerText = e instanceof Error ? e.message : String(e);
    const reason = `${subTitle} shared-container declaration is refused by the reader: ${readerText.split("\n")[0]}`;
    return { violations: [violation(reason, readerText)] };
  }

  const violations: TaskTrackingWorkspaceBindingViolation[] = [];
  const missing: string[] = [];
  if (adapterKey === "linear") {
    if (!binding.team) missing.push("team");
    if (!binding.project) missing.push("project");
  } else {
    if (!binding.project) missing.push("project");
  }
  if (missing.length > 0) {
    const reason = `${subTitle} sub-section is missing required key${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`;
    violations.push(violation(reason, buildMessage(reason, rel, resolved.mode)));
  }

  const paragraphs = stopParagraphs(locateSubsection(lines, adapterKey) ?? []);
  const rewrite = `re-run \`bun run ${WRITER} <projectRoot> ${adapterKey} --project <project> --shared <tag>\` to re-render it`;
  if (binding.shared) {
    // Leg (b) — exactly one paragraph, byte-equal to the render.
    const expected = renderSharedTrackerSentinel({
      adapter: adapterKey,
      project: binding.project ?? "",
      repoTag: binding.repoTag!,
      minDptVersion: binding.minDptVersion!,
    });
    let problem: string | null = null;
    if (paragraphs.length === 0) problem = "is absent";
    else if (paragraphs.length > 1) problem = `is present ${paragraphs.length} times`;
    else if (paragraphs[0] !== expected) {
      problem = `is not the render for project "${binding.project ?? ""}", tag "${binding.repoTag}" and floor ${binding.minDptVersion} (stale paragraph)`;
    }
    if (problem !== null) {
      const reason = `${subTitle} declares repo_tag "${binding.repoTag}" but the shared-container stop paragraph ${problem}`;
      violations.push(violation(reason, buildSharedMessage("paragraph", reason, `${rewrite}.`, rel, resolved.mode)));
    }
    // Leg (c) — the running toolkit version at or above the floor.
    let running: string | null = null;
    try {
      running = runningDptVersion();
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      const reason = `${subTitle} declares min_dpt_version ${binding.minDptVersion} but the running toolkit version is unknown: ${text.split("\n")[0]}`;
      violations.push(violation(reason, text));
    }
    if (running !== null) {
      const verdict = checkVersionFloor(binding, running);
      if (!verdict.ok) {
        const reason = `${subTitle} declares min_dpt_version ${verdict.floor}; the running toolkit version ${verdict.running} is below it`;
        violations.push(violation(reason, verdict.message));
      }
    }
  } else if (paragraphs.length > 0) {
    const reason = `${subTitle} carries a shared-container stop paragraph but declares no repo_tag (stale paragraph)`;
    violations.push(
      violation(
        reason,
        buildSharedMessage(
          "paragraph",
          reason,
          `delete the paragraph, or declare the container shared: ${rewrite}.`,
          rel,
          resolved.mode,
        ),
      ),
    );
  }

  const skipped: string[] = [];
  if (adapterKey !== "jira") skipped.push(KEY_PREFIX_SKIP);
  else if (!binding.project) skipped.push(`${KEY_PREFIX_LEG} (no bound project)`);
  else violations.push(...keyPrefixViolations(projectRoot, binding.project, resolved.mode));

  // A leg that did not run is listed, never counted as passed (STE-612).
  return { violations, skipped };
}

const KEY_PREFIX_LEG = "key-prefix leg";
const KEY_PREFIX_SKIP = `${KEY_PREFIX_LEG} (Jira only)`;
const REPOINT = "plugins/dev-process-toolkit/adapters/_shared/src/repoint_tracker_binding.ts";

/** The regular `.md` files directly under `dir` (never a sub-directory such as `archive/`), sorted by name. */
export function mdFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => e.name)
    .sort();
}

/**
 * The Epic-token prefix of Jira project `project`: `milestoneIdFromEpicKey(project)`
 * + `_` (STE-611's forward sanitization). `null` when the key does not sanitize
 * to a well-formed id — then no Epic token lies inside the project.
 */
export function epicTokenPrefix(project: string): string | null {
  try {
    return `${milestoneIdFromEpicKey(project)}_`;
  } catch {
    return null;
  }
}

/** True when `token` is an Epic-keyed milestone token outside the Epic-token prefix `prefix` (see `epicTokenPrefix`). */
export function epicTokenOutside(token: string, prefix: string | null): boolean {
  return parseMilestoneToken(token)?.kind === "epic" && (prefix === null || !token.startsWith(prefix));
}

/**
 * The `tracker.jira` key of an FR; `undefined` when it has none or its
 * frontmatter does not parse. Only this key is graded: another tracker's key
 * (`linear: STE-1`) is Jira-shaped but belongs to no Jira project.
 */
export function jiraKeyOf(content: string): string | undefined {
  const fm = frontmatterOf(content);
  const tracker = fm?.["tracker"];
  if (tracker === null || tracker === undefined || typeof tracker !== "object") return undefined;
  const key = (tracker as Record<string, unknown>)["jira"];
  return typeof key === "string" && key.length > 0 ? key : undefined;
}

/** `jiraKeyOf`, for an FR that is not `status: archived`. */
export function activeJiraKeyOf(content: string): string | undefined {
  return frontmatterOf(content)?.["status"] === "archived" ? undefined : jiraKeyOf(content);
}

function frontmatterOf(content: string): Record<string, unknown> | undefined {
  try {
    return parseFrontmatter(content, { lenient: true });
  } catch {
    return undefined;
  }
}

/** The project prefix of Jira-shaped tracker key `key` when it is not `project`; `undefined` when inside it or not Jira-shaped. */
export function foreignJiraKeyProject(key: string, project: string): string | undefined {
  const m = /^([A-Za-z][A-Za-z0-9_]*)-\d+$/.exec(key);
  return m !== null && m[1] !== project ? m[1] : undefined;
}

/** 1-based line of the first line containing `needle`, else 1. */
function lineOf(content: string, needle: string): number {
  const i = content.split("\n").findIndex((l) => l.includes(needle));
  return i >= 0 ? i + 1 : 1;
}

/** STE-612 — active FR keys and active Epic-keyed plan tokens outside the bound Jira project. */
function keyPrefixViolations(
  projectRoot: string,
  project: string,
  mode: string,
): TaskTrackingWorkspaceBindingViolation[] {
  const prefix = epicTokenPrefix(project);
  const out: TaskTrackingWorkspaceBindingViolation[] = [];
  const push = (abs: string, line: number, rawReason: string): void => {
    // A filename or key may carry a newline; nothing it supplies starts a line.
    const rel = oneLine(relative(projectRoot, abs));
    const reason = oneLine(rawReason);
    out.push({
      file: abs,
      line,
      reason,
      note: `${rel}:${line} — ${reason}`,
      message: nfr10Message(
        `task_tracking_workspace_binding_present: ${reason}`,
        `the bound project was changed without the repoint command — restore \`project:\` and run \`bun run ${REPOINT} <projectRoot> jira ${project} --projects <file> --containers <file>\`, or archive the FR / plan before repointing.`,
        `file=${rel}, mode=${mode}, leg=key-prefix, project=${project}, probe=task_tracking_workspace_binding_present`,
      ),
    });
  };

  const frsDir = join(projectRoot, "specs", "frs");
  for (const name of mdFiles(frsDir)) {
    const abs = join(frsDir, name);
    const content = readFileSync(abs, "utf-8");
    const key = activeJiraKeyOf(content);
    const foreign = key === undefined ? undefined : foreignJiraKeyProject(key, project);
    if (key === undefined || foreign === undefined) continue;
    push(abs, lineOf(content, key), `active FR tracker key "${key}" is in project "${foreign}", not the bound Jira project "${project}"`);
  }

  const planDir = join(projectRoot, "specs", "plan");
  for (const name of mdFiles(planDir)) {
    if (!PLAN_FILENAME_RE.test(name)) continue;
    const token = name.slice(0, -".md".length);
    if (!epicTokenOutside(token, prefix)) continue;
    const abs = join(planDir, name);
    const content = readFileSync(abs, "utf-8");
    push(
      abs,
      lineOf(content, token),
      `active Epic-keyed plan "${token}" does not start with "${prefix ?? `M_${project}_`}", the bound Jira project "${project}"`,
    );
  }
  return out;
}

if (import.meta.main) {
  const root = process.argv[2] ?? process.cwd();
  const report = await runTaskTrackingWorkspaceBindingPresentProbe(root);
  if (report.violations.length === 0) {
    process.stdout.write("task_tracking_workspace_binding_present: OK\n");
  } else {
    for (const v of report.violations) process.stdout.write(`${v.note}\n${v.message}\n`);
    process.exit(1);
  }
}

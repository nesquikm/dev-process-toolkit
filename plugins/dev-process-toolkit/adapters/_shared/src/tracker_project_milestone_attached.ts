// tracker_project_milestone_attached — /gate-check probe (#26, STE-118 AC-STE-118.6, STE-194 AC-STE-194.1..5, STE-214 AC-STE-214.1..6).
//
// For each `status: active` FR with a tracker block, assert that the
// tracker ticket's `projectMilestone.name` byte-equals the canonical
// milestone name derived from the local plan-file milestone heading (parsed
// via the shared `parsePlanHeading`, which accepts both the current `## M<N>:`
// and legacy `# M<N> —` forms — STE-335). Closes the drift surface where
// /spec-write didn't auto-attach (STE-115/116 origin).
//
// Vacuous on:
//   - mode: none
//   - archived FRs (immutable, AC-STE-18.4)
//   - active FRs without a `tracker:` block (FR is local-only despite tracker mode)
//   - active FRs whose plan file is missing (probe #27 owns that diagnostic)
//
// Hard fails:
//   - ticket projectMilestone is null  (unless the capability-gap downgrade fires — see below)
//   - ticket projectMilestone.name != canonical local heading
//
// Capability-gap downgrade (STE-194 + STE-214). When the FR's `## Notes`
// section contains a word-bounded match of any of the three milestone-
// attach capability tokens — `milestone_attach_skipped_adapter_limit`
// (canonical), `milestone_attach_unavailable` (deprecated alias per
// STE-198), or `milestone_create_required` — and the ticket has no
// `projectMilestone`, the missing-binding outcome routes to `advisories`
// instead of `violations`. The advisory prose names whichever key was
// found so the operator can grep the cap. Mismatched bindings still
// hard-fail — the token only excuses absence, not divergence.
//
// Diagnostic format (AC-STE-118.6 / .7) shows both byte-rendered strings
// so em-dash drift is visible. The remedy points at
// `/spec-write --rename-milestone M<N>` for the rename-on-mismatch flow.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { milestoneLabel } from "./attach_project_milestone";
import { parsePlanHeading } from "./plan_heading";

export interface TrackerProjectMilestoneAttachedViolation {
  file: string;
  line: number;
  reason: string;
  note: string;
  message: string;
}

export interface TrackerProjectMilestoneAttachedAdvisory {
  file: string;
  line: number;
  reason: string;
  note: string;
  message: string;
}

export interface TrackerProjectMilestoneAttachedReport {
  violations: TrackerProjectMilestoneAttachedViolation[];
  advisories: TrackerProjectMilestoneAttachedAdvisory[];
}

export interface TrackerProjectMilestoneAttachedDeps {
  /**
   * Looks up the issue's projectMilestone via the active adapter. Wraps
   * `mcp__linear__get_issue` in production; tests inject a stub.
   * Returning `{ projectMilestone: null }` indicates the ticket exists but
   * has no milestone attached. Throwing is treated as an opaque hard fail.
   * On the `label` (Jira) binding the probe consults `labels` instead of
   * `projectMilestone`; the object branch ignores `labels`.
   */
  getIssue: (
    ticketId: string,
  ) => Promise<{ projectMilestone?: { name: string } | null; labels?: string[] }>;
  /**
   * Which milestone-binding the active adapter uses. `object` (Linear,
   * default when absent) verifies `projectMilestone.name`; `label` (Jira)
   * verifies that the ticket's `labels` array contains `milestone-<M-token>`.
   * In production the gate wires this from the active adapter's
   * `milestone_binding:` frontmatter.
   */
  milestoneBinding?: "object" | "label";
}

interface FrFrontmatter {
  milestone: string | null;
  status: string | null;
  // The bound tracker's key (`linear`, `jira`, or a custom adapter key) and
  // ticket id, read from the first sub-key under the `tracker:` block. The
  // probe is adapter-agnostic: a repo is bound to exactly one tracker
  // (`mode:` in CLAUDE.md), so the first sub-key is the active binding —
  // STE-329 generalized this from the prior `linear:`-only parse so the
  // Jira `label` branch can find `jira:`-bound FRs.
  trackerKey: string | null;
  trackerId: string | null;
}

function parseFrFrontmatter(content: string): FrFrontmatter {
  const lines = content.split("\n");
  if (lines[0] !== "---") {
    return { milestone: null, status: null, trackerKey: null, trackerId: null };
  }
  let milestone: string | null = null;
  let status: string | null = null;
  let trackerKey: string | null = null;
  let trackerId: string | null = null;
  let inTracker = false;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line === "---") break;
    // Two canonical tracker shapes (Schema Q):
    //   tracker: {}            — empty (no tracker bound)
    //   tracker:               — followed by indented `  <key>: <id>` lines
    // Any other shape on the `tracker:` line itself (inline mapping with
    // values, e.g. `tracker: { linear: STE-1 }`) is non-canonical for /implement
    // and falls through to the generic key parser below — we only enter
    // `inTracker` for the indented-block shape.
    if (line === "tracker: {}") {
      inTracker = false;
      continue;
    }
    if (line === "tracker:") {
      inTracker = true;
      continue;
    }
    if (inTracker && /^\s+[a-z_]+:/.test(line)) {
      // First indented `<key>: <id>` under `tracker:` is the active binding.
      const m = /^\s+([a-z_]+):\s*(\S+)\s*$/.exec(line);
      if (m && trackerKey === null) {
        trackerKey = m[1]!;
        trackerId = m[2]!;
      }
      continue;
    }
    // Leaving the indented block.
    if (!/^\s/.test(line)) inTracker = false;
    const m = /^([a-z_]+):\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    if (m[1] === "milestone") milestone = m[2]!.trim();
    else if (m[1] === "status") status = m[2]!.trim();
  }
  return { milestone, status, trackerKey, trackerId };
}

// STE-335: the `missing` remedy's manual-attach hint is binding-aware. The
// `label` (Jira) branch — now reachable on current-format `## M<N>:` plans once
// readPlanHeading delegates to the shared parser — would otherwise misdirect a
// Jira operator to the Linear-only `save_issue` call. Mirrors the binding-aware
// split already in MilestoneAttachmentError (STE-329). The `mismatch` kind only
// fires on the object branch, so it stays Linear-specific.
function buildMessage(
  reason: string,
  file: string,
  kind: "missing" | "mismatch",
  binding: "object" | "label" = "object",
): string {
  const manualAttach =
    binding === "label"
      ? "Or attach manually via your tracker's edit-issue call (e.g. mcp__atlassian__editJiraIssue) adding the `milestone-<M-token>` label to the issue's existing labels (read-merge-write — never clobber)."
      : "Or attach manually via mcp__linear__save_issue(id=<ticket>, milestone=<canonical name from plan heading>).";
  const remedy =
    kind === "missing"
      ? `Run /implement Phase 1 against this FR — Phase 1 entry calls attachProjectMilestone() idempotently. ${manualAttach}`
      : "If the local plan-file heading is correct, run /spec-write --rename-milestone M<N> to rename the Linear milestone to match. If the tracker side is correct, edit specs/plan/M<N>.md heading to match.";
  return [
    `tracker_project_milestone_attached: ${reason}`,
    `Remedy: ${remedy}`,
    `Context: file=${file}, probe=tracker_project_milestone_attached`,
  ].join("\n");
}

// STE-214: probe #26 honors any of three milestone-attach capability keys
// declared in the FR's `## Notes` section (canonical + deprecated alias +
// auto-create flag). All map to identical ADVISORY behavior; the rendered
// prose names whichever key was found so the operator can grep the cap.
const CAPABILITY_GAP_TOKENS = [
  "milestone_attach_skipped_adapter_limit",
  "milestone_attach_unavailable",
  "milestone_create_required",
] as const;
type CapabilityGapToken = (typeof CAPABILITY_GAP_TOKENS)[number];
const CAPABILITY_GAP_RES = CAPABILITY_GAP_TOKENS.map(
  (t) => [t, new RegExp(`\\b${t}\\b`)] as [CapabilityGapToken, RegExp],
);
const capabilityGapProse = (token: CapabilityGapToken): string =>
  `milestone-attach skipped — capability gap declared in FR Notes (${token})`;

/**
 * Returns the body of the FR's `## Notes` section (everything between the
 * `## Notes` heading and the next `##` heading or EOF). Empty string when
 * no `## Notes` section exists. Sub-headings (`### …`) inside `## Notes`
 * stay scoped to Notes — only the next `##` heading closes the section.
 */
function extractNotesSection(content: string): string {
  const lines = content.split("\n");
  const notesLines: string[] = [];
  let inNotes = false;
  for (const line of lines) {
    if (/^##(?!#)/.test(line)) {
      inNotes = /^## Notes(\s|$)/.test(line);
      continue;
    }
    if (inNotes) notesLines.push(line);
  }
  return notesLines.join("\n");
}

function notesCapabilityGapToken(content: string): CapabilityGapToken | null {
  const notes = extractNotesSection(content);
  for (const [token, re] of CAPABILITY_GAP_RES) {
    if (re.test(notes)) return token;
  }
  return null;
}

function buildAdvisoryMessage(file: string, token: CapabilityGapToken): string {
  return [
    `tracker_project_milestone_attached: ${capabilityGapProse(token)}`,
    `Note: probe #26 downgraded the missing-binding outcome to advisory because the FR's \`## Notes\` section declares the \`${token}\` capability key.`,
    `Context: file=${file}, probe=tracker_project_milestone_attached`,
  ].join("\n");
}

/**
 * Capability-gap downgrade, shared by both the `label` (Jira) and `object`
 * (Linear) binding branches: when the FR's `## Notes` declares a capability
 * token, the missing-binding outcome routes to `advisories` instead of
 * `violations`. Returns the advisory to push, or `null` when no token is
 * declared (caller then hard-fails with a binding-specific violation).
 */
function capabilityGapAdvisory(
  content: string,
  fullPath: string,
  rel: string,
): TrackerProjectMilestoneAttachedAdvisory | null {
  const declaredToken = notesCapabilityGapToken(content);
  if (declaredToken === null) return null;
  const prose = capabilityGapProse(declaredToken);
  return {
    file: fullPath,
    line: 1,
    reason: prose,
    note: `${rel}:1 — ${prose}`,
    message: buildAdvisoryMessage(rel, declaredToken),
  };
}

function isTrackerMode(claudeMdContent: string): boolean {
  const lines = claudeMdContent.split("\n");
  const startIdx = lines.findIndex((l) => l === "## Task Tracking");
  if (startIdx < 0) return false;
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    // Aligned with task_tracking_canonical_keys.ts boundary-detection convention.
    if (/^#{1,2}\s/.test(lines[i]!)) {
      endIdx = i;
      break;
    }
  }
  for (let i = startIdx + 1; i < endIdx; i++) {
    const m = /^mode:\s*(\S+)\s*$/.exec(lines[i]!);
    if (m) {
      const mode = m[1]!;
      return mode !== "none" && mode !== "";
    }
  }
  return false;
}

function readPlanHeading(planPath: string): string | null {
  if (!existsSync(planPath)) return null;
  const md = readFileSync(planPath, "utf-8");
  return parsePlanHeading(md);
}

export async function runTrackerProjectMilestoneAttachedProbe(
  projectRoot: string,
  deps: TrackerProjectMilestoneAttachedDeps,
): Promise<TrackerProjectMilestoneAttachedReport> {
  const claudeMd = join(projectRoot, "CLAUDE.md");
  if (!existsSync(claudeMd)) return { violations: [], advisories: [] };
  const claudeMdContent = readFileSync(claudeMd, "utf-8");
  if (!isTrackerMode(claudeMdContent)) return { violations: [], advisories: [] };

  const frsDir = join(projectRoot, "specs", "frs");
  if (!existsSync(frsDir)) return { violations: [], advisories: [] };

  const violations: TrackerProjectMilestoneAttachedViolation[] = [];
  const advisories: TrackerProjectMilestoneAttachedAdvisory[] = [];
  const entries = readdirSync(frsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const fullPath = join(frsDir, entry.name);
    const rel = relative(projectRoot, fullPath);
    const content = readFileSync(fullPath, "utf-8");
    const fm = parseFrFrontmatter(content);
    if (fm.status !== "active") continue;
    if (!fm.trackerId || !fm.trackerKey) continue;
    if (!fm.milestone) continue;

    const trackerRef = `${fm.trackerKey}:${fm.trackerId}`;
    const planPath = join(projectRoot, "specs", "plan", `${fm.milestone}.md`);
    const heading = readPlanHeading(planPath);
    if (heading === null) continue; // probe #27 owns the orphan/missing-plan diagnostic

    let issue: { projectMilestone?: { name: string } | null; labels?: string[] };
    try {
      issue = await deps.getIssue(fm.trackerId);
    } catch (e) {
      const reason = `tracker fetch for ${trackerRef} failed: ${e instanceof Error ? e.message : String(e)}`;
      violations.push({
        file: fullPath,
        line: 1,
        reason,
        note: `${rel}:1 — ${reason}`,
        message: buildMessage(reason, rel, "missing", deps.milestoneBinding),
      });
      continue;
    }

    // STE-329 AC-STE-329.5: adapter-aware verification surface. The `label`
    // (Jira) branch asserts the ticket's `labels` array contains
    // `milestone-<M-token>`; the `object` (Linear / default) branch below
    // verifies `projectMilestone.name`.
    if (deps.milestoneBinding === "label") {
      const expectedLabel = milestoneLabel(heading);
      const labels = issue.labels ?? [];
      if (labels.includes(expectedLabel)) continue;
      // Missing / empty / mismatched label. The capability-gap downgrade
      // (token in `## Notes`) still excuses absence on the label branch.
      const advisory = capabilityGapAdvisory(content, fullPath, rel);
      if (advisory !== null) {
        advisories.push(advisory);
        continue;
      }
      const reason = `${rel} (${trackerRef}) is missing milestone label — expected "${expectedLabel}"`;
      violations.push({
        file: fullPath,
        line: 1,
        reason,
        note: `${rel}:1 — ${trackerRef} labels missing "${expectedLabel}" (not attached)`,
        message: buildMessage(reason, rel, "missing", "label"),
      });
      continue;
    }

    const attached = issue.projectMilestone?.name ?? null;
    if (attached === null) {
      // STE-194 + STE-214: capability-gap downgrade. Any of the three
      // milestone-attach tokens in `## Notes` excuses the missing binding
      // (smoke fixtures and other intentional gaps); absent any token still
      // hard-fails — the gate must continue to fire on FRs that should
      // have been attached.
      const advisory = capabilityGapAdvisory(content, fullPath, rel);
      if (advisory !== null) {
        advisories.push(advisory);
        continue;
      }
      const reason = `${rel} (${trackerRef}) is missing projectMilestone — expected "${heading}"`;
      violations.push({
        file: fullPath,
        line: 1,
        reason,
        note: `${rel}:1 — ${trackerRef} not attached to projectMilestone (expected "${heading}")`,
        message: buildMessage(reason, rel, "missing"),
      });
      continue;
    }
    if (attached !== heading) {
      const reason = `${rel} (${trackerRef}) projectMilestone mismatch — local: "${heading}" vs tracker: "${attached}"`;
      violations.push({
        file: fullPath,
        line: 1,
        reason,
        note: `${rel}:1 — ${trackerRef} milestone "${attached}" != local "${heading}"`,
        message: buildMessage(reason, rel, "mismatch"),
      });
    }
  }
  return { violations, advisories };
}

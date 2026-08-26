// tracker_project_milestone_attached — /gate-check probe (#26, STE-118 AC-STE-118.6, STE-194 AC-STE-194.1..5, STE-214 AC-STE-214.1..6).
//
// For each `status: active` FR with a tracker block, assert that the
// tracker ticket's `projectMilestone.name` byte-equals the canonical
// milestone name derived from the local plan-file milestone heading (parsed
// via the shared `parsePlanHeading`, which accepts the current `## M<N> —`
// H2 form and still parses the legacy `# M<N> —` H1 and `## M<N>: <title>`
// colon forms — STE-335). Closes the drift surface where
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
// Diagnostic format (AC-STE-118.6; the sibling .7 escape-hatch AC it once
// cited was retired by STE-525, whose flag never existed) shows both
// byte-rendered strings so em-dash drift is visible. The mismatch remedy is
// binding-aware and names only operations that exist: on the OBJECT binding,
// rename the tracker milestone to the canonical heading via
// `mcp__linear__save_issue`; or — when the tracker side is the correct one —
// edit the `specs/plan/M<N>.md` heading to match.
//
// The mismatch kind reaches ONLY the object binding, and the remedy prose is
// scoped to it deliberately. `mismatch` has a single call site, inside the
// object branch's `attached !== heading`, and `attached` comes only from
// `projectMilestone.name`. An earlier version of this paragraph offered
// `mcp__atlassian__editJiraIssue` "on the label binding" — false twice over:
// that arm is unreachable, and there is no tracker milestone to rename on the
// label surface at all, since labels ARE Jira's milestone surface here. The
// epic and label arms below are kept because deleting them would let a future
// caller fall through to the `object` default and hand a Jira operator a
// Linear call again — but they are dead today, and this comment says so
// rather than advertising them as live behaviour.
//
// Under the `epic` binding a name mismatch is not a binding failure at all:
// STE-521 made that leg resolve the milestone Epic by its KEY — sanitizing
// each candidate key forward and comparing to the plan heading's token —
// never by its summary. So the missing-binding remedy there names the absent
// Epic key rather than ordering a reconciliation of names.
// No rename flag has ever existed on `/spec-write`; the
// remedy this replaced ordered one that never shipped. The Epic-keyed
// `epic` binding is the exception (STE-521/STE-525): the Epic is resolved
// by KEY and its summary is never read, so a name mismatch is not a
// binding failure there — its remedy names the absent Epic key instead of
// any rename.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { milestoneBindingPresent, milestoneLabel } from "./attach_project_milestone";
import { parsePlanHeading } from "./plan_heading";
import { normalizeFrontmatterSource } from "./frontmatter";

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
  ) => Promise<{ projectMilestone?: { name: string } | null; labels?: string[]; parent?: string | null }>;
  /**
   * Which milestone-binding the active adapter uses. `object` (Linear,
   * default when absent) verifies `projectMilestone.name`; `label` (Jira
   * legacy) verifies that the ticket's `labels` array contains
   * `milestone-<M-token>`; `epic` (Jira Epic-first) verifies the ticket's
   * `parent` key sanitizes back to the Epic-keyed milestone token, falling
   * back to the label surface for grandfathered numeric milestones.
   *
   * The value is supplied by the CALLER on this deps object; no adapter key is
   * parsed for it. `adapters/jira.md` declares `milestone_binding: epic` in its
   * own frontmatter, but nothing reads that key at runtime — an earlier version
   * of this comment claimed the gate wired the value from there, which sent
   * readers hunting for a parser that has never existed.
   */
  milestoneBinding?: "object" | "label" | "epic";
}

export interface FrFrontmatter {
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

// Exported: assert_milestone_binding_at_archive (the archival-boundary
// assertion, M97) shares this walk so the two milestone-binding surfaces
// can never drift on frontmatter interpretation.
export function parseFrFrontmatter(rawContent: string): FrFrontmatter {
  // Normalize first. This walk is SHARED with the M97 archival-boundary
  // assertion, so a CRLF/BOM FR would blind both milestone-binding surfaces
  // at once — the exact drift this export exists to prevent.
  const lines = normalizeFrontmatterSource(rawContent).split("\n");
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
// `label` (Jira) branch — now reachable on canonical `## M<N> —` plans once
// readPlanHeading delegates to the shared parser — would otherwise misdirect a
// Jira operator to the Linear-only `save_issue` call. Mirrors the binding-aware
// split already in MilestoneAttachmentError (STE-329).
//
// STE-525 gave the `mismatch` half the same split, so no arm names a Linear call
// on a Jira binding. Reachability is asymmetric and deliberate: `mismatch` is
// passed from exactly ONE call site — the `object` branch's name comparison —
// because the `epic` and `label` branches route every binding failure, divergent
// or absent, through `missing`. Their `mismatch` arms are defensive, so a future
// caller inherits a binding-correct remedy instead of the Linear-specific string
// this replaced; do not delete them without first proving no caller can arrive.
function buildMessage(
  reason: string,
  file: string,
  kind: "missing" | "mismatch",
  binding: "object" | "label" | "epic" = "object",
  expectedToken?: string,
): string {
  // STE-525: the Epic-keyed leg of the `epic` binding resolves the milestone
  // Epic by KEY (STE-521) — every candidate Epic's key is sanitized forward
  // (`GF-78` → `M_GF_78`) and compared to the plan heading's token. The Epic's
  // summary is not consulted on that path at all, so a name mismatch cannot be
  // why the binding failed, and a remedy ordering the operator to reconcile
  // names would describe a mechanism this milestone removed. Exactly one thing
  // can still be wrong: no Epic in the project carries the key the token
  // encodes. Both kinds share this remedy because only `missing` can arise.
  // Grandfathered numeric milestones (token not `M_`-prefixed) bind through the
  // label fallback instead and keep the generic arms below.
  if (binding === "epic" && (expectedToken ?? "").startsWith("M_")) {
    const epicRemedy =
      "The milestone Epic is resolved by its key, never by its summary — a name mismatch is not a binding failure " +
      `on this binding. What is absent is an Epic whose key sanitizes to \`${expectedToken}\` (e.g. \`GF-78\` → ` +
      "`M_GF_78`): create or locate that Epic in the project, then set this issue's `parent` to that Epic's key via " +
      "mcp__atlassian__editJiraIssue additional_fields.parent (/implement Phase 1 calls attachProjectMilestone() " +
      "idempotently and does the same). If the tracker side is correct — the Epic that exists is the intended one — " +
      "re-key the milestone to it: an Epic-keyed milestone lives at `specs/plan/M_<epic-key>.md`, so the plan " +
      "FILE, its `## M_<epic-key> — <Title>` heading and each bound FR's `milestone:` frontmatter all move " +
      "together. Editing the heading alone leaves the id and the filename disagreeing, which turns probe #27 red.";
    return [
      `tracker_project_milestone_attached: ${reason}`,
      `Remedy: ${epicRemedy}`,
      `Context: file=${file}, probe=tracker_project_milestone_attached`,
    ].join("\n");
  }
  const manualAttach =
    binding === "epic"
      ? "Or attach manually via your tracker's edit-issue call (e.g. mcp__atlassian__editJiraIssue additional_fields.parent) setting the issue's `parent` to the milestone Epic's key."
      : binding === "label"
        ? "Or attach manually via your tracker's edit-issue call (e.g. mcp__atlassian__editJiraIssue) adding the `milestone-<M-token>` label to the issue's existing labels (read-merge-write — never clobber)."
        : "Or attach manually via mcp__linear__save_issue(id=<ticket>, milestone=<canonical name from plan heading>).";
  // The mismatch half branches on binding exactly like the manual-attach half
  // above: each arm names a write call the bound adapter actually documents
  // (adapters/linear.md / adapters/jira.md), and every arm preserves the
  // other direction — tracker side correct ⇒ edit the plan heading.
  const mismatchRemedy =
    binding === "epic"
      ? "If the local plan-file heading is correct, re-point the issue's `parent` at the milestone Epic for that heading via mcp__atlassian__editJiraIssue additional_fields.parent. If the tracker side is correct, edit specs/plan/M<N>.md heading to match."
      : binding === "label"
        ? "If the local plan-file heading is correct, update the issue's milestone label to the `milestone-<M-token>` derived from that heading via mcp__atlassian__editJiraIssue (read-merge-write the existing labels — never clobber). If the tracker side is correct, edit specs/plan/M<N>.md heading to match."
        : "If the local plan-file heading is correct, rename the tracker milestone to that exact string via mcp__linear__save_issue(id=<ticket>, milestone=<canonical name from plan heading>) — /implement Phase 1 performs the same attach idempotently. If the tracker side is correct, edit specs/plan/M<N>.md heading to match.";
  const remedy =
    kind === "missing"
      ? `Run /implement Phase 1 against this FR — Phase 1 entry calls attachProjectMilestone() idempotently. ${manualAttach}`
      : mismatchRemedy;
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

    let issue: { projectMilestone?: { name: string } | null; labels?: string[]; parent?: string | null };
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

    // STE-329 AC-STE-329.5: adapter-aware verification surface. The `epic`
    // (Jira Epic-first) branch routes through the shared
    // milestoneBindingPresent predicate — parent-key sanitize check for
    // Epic-keyed milestones, label fallback for grandfathered numeric ones;
    // the `label` (Jira legacy) branch asserts the ticket's `labels` array
    // contains `milestone-<M-token>`; the `object` (Linear / default) branch
    // below verifies `projectMilestone.name`.
    if (deps.milestoneBinding === "epic") {
      if (milestoneBindingPresent(issue, heading, "epic")) continue;
      const advisory = capabilityGapAdvisory(content, fullPath, rel);
      if (advisory !== null) {
        advisories.push(advisory);
        continue;
      }
      const token = heading.split(/\s/, 1)[0] ?? "";
      const expectedDesc = token.startsWith("M_")
        ? `parent Epic key sanitizing to "${token}" (observed parent: ${issue.parent ? `"${issue.parent}"` : "none"})`
        : `label "${milestoneLabel(heading)}" (grandfathered numeric milestone under the epic binding)`;
      const reason = `${rel} (${trackerRef}) is missing its milestone binding — expected ${expectedDesc}`;
      violations.push({
        file: fullPath,
        line: 1,
        reason,
        note: `${rel}:1 — ${trackerRef} epic milestone binding missing (expected ${expectedDesc})`,
        message: buildMessage(reason, rel, "missing", "epic", token),
      });
      continue;
    }
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

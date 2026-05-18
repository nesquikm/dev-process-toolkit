// STE-303 — tracker-config write helper: builds the role-to-status proposal,
// renders a unified diff against any baseline, prompts the operator via
// AskUserQuestion (approve / edit / cancel), and routes approve through
// STE-302's writeTrackerConfig.
//
// The helper is dependency-injected so unit tests can script every input
// (fetchStatuses, askUserQuestion, writeTrackerConfig, chooseRole). The
// /setup skill body (Step Nb) wires the real implementations: MCP-driven
// status fetch, AskUserQuestion tool call, STE-302's writeTrackerConfig.
//
// Outcomes (literal token = capability-key surfaced in the closing summary):
//   - succeeded               → proposal approved + write fired
//   - unchanged               → baseline == proposal, no prompt, no write
//   - cancelled               → operator cancelled, no write
//   - skipped_mode_none       → tracker mode == "none", vacuous
//   - skipped_adapter_limit   → adapter lacks list_project_statuses capability
//   - mcp_unavailable         → MCP fetch threw; NFR-10 canonical refusal

import {
  CANONICAL_ROLES,
  readTrackerConfig,
  type Role,
  type TrackerConfig,
  type TrackerKey,
} from "./tracker_config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Outcome =
  | "succeeded"
  | "unchanged"
  | "cancelled"
  | "skipped_mode_none"
  | "skipped_adapter_limit"
  | "mcp_unavailable";

export interface Proposal {
  tracker_key: string;
  statuses: string[];
  roles: Record<string, string | null>;
  reasoning: Record<string, string>;
}

export interface ChooseRoleResult {
  status: string | null;
  reasoning: string;
}

export interface ProposalDeps {
  fetchStatuses: (adapterKey: string) => Promise<string[]>;
  askUserQuestion: (spec: unknown) => Promise<Record<string, unknown>>;
  writeTrackerConfig: (specsDir: string, config: TrackerConfig) => void;
  chooseRole: (role: string, statuses: string[]) => ChooseRoleResult;
}

export interface AdapterCapabilities {
  list_project_statuses?: boolean;
}

export interface RunTrackerConfigWriteOpts {
  specsDir: string;
  adapterKey: string;
  mode: string;
  autoApprove: boolean;
  deps: ProposalDeps;
  adapterCapabilities?: AdapterCapabilities;
}

export interface RunResult {
  outcome: Outcome;
  message?: string;
}

// ---------------------------------------------------------------------------
// AC-STE-303.11 — closing-summary capability key literals
// ---------------------------------------------------------------------------

export const CLOSING_SUMMARY_KEYS = [
  "tracker_config_write_succeeded",
  "tracker_config_write_cancelled",
  "tracker_config_unchanged",
  "tracker_config_write_skipped_adapter_limit",
  "tracker_config_write_mcp_unavailable",
] as const;

// ---------------------------------------------------------------------------
// AC-STE-303.4 — buildTrackerConfigProposal
// ---------------------------------------------------------------------------

export interface BuildProposalOpts {
  adapterKey: string;
  statuses: string[];
  chooseRole: (role: string, statuses: string[]) => ChooseRoleResult;
}

/**
 * Compose a tracker-config proposal: take the verbatim statuses from the
 * active adapter and, for each canonical role, ask the injected `chooseRole`
 * callback which status to map to (and why). The callback is the LLM-judgment
 * seam — in production, the running /setup skill is the chooser; in tests
 * we inject a deterministic mock.
 */
export function buildTrackerConfigProposal(opts: BuildProposalOpts): Proposal {
  const roles: Record<string, string | null> = {};
  const reasoning: Record<string, string> = {};
  for (const role of CANONICAL_ROLES) {
    const r = opts.chooseRole(role, opts.statuses);
    roles[role] = r.status;
    reasoning[role] = r.reasoning;
  }
  return {
    tracker_key: opts.adapterKey,
    statuses: opts.statuses.slice(),
    roles,
    reasoning,
  };
}

// ---------------------------------------------------------------------------
// AC-STE-303.4 — serializeProposalYAML
// ---------------------------------------------------------------------------

/**
 * Block-style YAML writer mirroring `tracker_config.ts`'s `serializeConfig`
 * shape so a proposal and the on-disk file are textually comparable. Roles
 * with `null` mappings are serialized as `~` (YAML null) — these will fail
 * `validateTrackerConfig`, but the YAML text still renders cleanly so the
 * operator sees the gap in the diff before editing.
 */
export function serializeProposalYAML(proposal: Proposal): string {
  const lines: string[] = [];
  lines.push(`tracker_key: ${proposal.tracker_key}`);
  lines.push("statuses:");
  for (const s of proposal.statuses) {
    lines.push(`  - ${s}`);
  }
  lines.push("roles:");
  for (const role of CANONICAL_ROLES) {
    const mapped = proposal.roles[role];
    lines.push(`  ${role}: ${mapped === null || mapped === undefined ? "~" : mapped}`);
  }
  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// AC-STE-303.5 — renderUnifiedDiff
// ---------------------------------------------------------------------------

/**
 * Render a minimal unified diff between `baseline` and `proposal` YAML
 * strings. Output shape mirrors `git diff --no-color` enough for the
 * operator to read: `---`/`+++` headers, then one `+`/`-` line per
 * differing line. Common lines are rendered with a leading space.
 *
 * Empty baseline → renders only `+` lines (first-run shape).
 */
export function renderUnifiedDiff(baseline: string, proposal: string): string {
  const baseLines = baseline === "" ? [] : baseline.split("\n");
  const propLines = proposal === "" ? [] : proposal.split("\n");

  const out: string[] = [];
  out.push("--- specs/tracker-config.yaml (baseline)");
  out.push("+++ specs/tracker-config.yaml (proposal)");

  // Naive line-by-line diff sufficient for the small, fixed schema. Walks
  // both line lists in lockstep, emitting `-` for baseline-only lines,
  // `+` for proposal-only lines, ` ` for shared lines. The full LCS
  // algorithm is overkill for the ~10-line schema this helper writes.
  const max = Math.max(baseLines.length, propLines.length);
  for (let i = 0; i < max; i++) {
    const b = baseLines[i];
    const p = propLines[i];
    if (b === undefined && p !== undefined) {
      out.push(`+${p}`);
    } else if (p === undefined && b !== undefined) {
      out.push(`-${b}`);
    } else if (b === p) {
      out.push(` ${b}`);
    } else {
      out.push(`-${b}`);
      out.push(`+${p}`);
    }
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// AC-STE-303.6 — isProposalNoOp
// ---------------------------------------------------------------------------

/**
 * Compare baseline and proposal YAML modulo trailing whitespace. Identical
 * logical YAML short-circuits the prompt + write (idempotent re-entry).
 */
export function isProposalNoOp(baseline: string, proposal: string): boolean {
  const norm = (s: string) =>
    s.replace(/[ \t]+$/gm, "").replace(/\n+$/g, "").replace(/^\s+/, "");
  return norm(baseline) === norm(proposal);
}

// ---------------------------------------------------------------------------
// AC-STE-303.1 / 303.5 / 303.6 / 303.7 / 303.8 / 303.9 — runTrackerConfigWrite
// ---------------------------------------------------------------------------

function buildMcpUnavailableMessage(err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err);
  return [
    `Refusing: tracker-config write — MCP status fetch failed (${detail}).`,
    `Remedy: re-authenticate the tracker MCP server and re-run /setup --resume-tracker-binding (or /setup --migrate). The status list MUST come from the active adapter; falling back to a hard-coded vocabulary would silently drift from the project's tracker workflow.`,
    `Context: mode=tracker-config-write, stage=fetchStatuses, error=${detail}`,
  ].join("\n");
}

function proposalToConfig(proposal: Proposal): TrackerConfig {
  const roles: Record<Role, string> = {} as Record<Role, string>;
  for (const role of CANONICAL_ROLES) {
    const mapped = proposal.roles[role];
    // Null roles cannot ride into a written config — validateTrackerConfig
    // would reject them. The caller routes through edit branch when a role
    // is null; if we get here with a null we let validation surface it.
    roles[role] = (mapped ?? "") as string;
  }
  return {
    tracker_key: proposal.tracker_key as TrackerKey,
    statuses: proposal.statuses.slice(),
    roles,
  };
}

function readBaselineYAML(specsDir: string): string {
  try {
    const baseline = readTrackerConfig(specsDir);
    if (baseline === null) return "";
    // Re-serialize via the proposal shape so logical equality reduces to
    // string equality after whitespace normalization.
    const proposal: Proposal = {
      tracker_key: baseline.tracker_key,
      statuses: baseline.statuses,
      roles: { ...baseline.roles },
      reasoning: { initial: "", in_progress: "", in_review: "", done: "" },
    };
    return serializeProposalYAML(proposal);
  } catch {
    // Malformed baseline shouldn't short-circuit the write — let the
    // operator see the diff against an empty baseline and re-author.
    return "";
  }
}

/**
 * Top-level orchestration:
 *   1. mode == "none" → outcome=skipped_mode_none (vacuous, no MCP, no write).
 *   2. adapter capability list_project_statuses === false → outcome=skipped_adapter_limit.
 *   3. fetchStatuses throws → outcome=mcp_unavailable + NFR-10 message.
 *   4. Build proposal, serialize YAML, compute diff against baseline.
 *   5. Logical no-op → outcome=unchanged, no prompt, no write.
 *   6. autoApprove === true → default-apply approve → write → succeeded.
 *   7. askUserQuestion(approve / edit / cancel):
 *        approve → write → succeeded
 *        cancel  → no write → cancelled
 *        edit    → per-role re-pick → write → succeeded
 */
export async function runTrackerConfigWrite(
  opts: RunTrackerConfigWriteOpts,
): Promise<RunResult> {
  // AC-STE-303.7 — mode: none vacuous.
  if (opts.mode === "none") {
    return { outcome: "skipped_mode_none" };
  }

  // AC-STE-303.9 — adapter without list_project_statuses → graceful skip.
  if (opts.adapterCapabilities && opts.adapterCapabilities.list_project_statuses === false) {
    return { outcome: "skipped_adapter_limit" };
  }

  // AC-STE-303.8 — MCP unavailable → NFR-10 canonical refusal.
  let statuses: string[];
  try {
    statuses = await opts.deps.fetchStatuses(opts.adapterKey);
  } catch (err) {
    return {
      outcome: "mcp_unavailable",
      message: buildMcpUnavailableMessage(err),
    };
  }

  // AC-STE-303.4 — build proposal + serialize YAML.
  const proposal = buildTrackerConfigProposal({
    adapterKey: opts.adapterKey,
    statuses,
    chooseRole: opts.deps.chooseRole,
  });
  const proposalYaml = serializeProposalYAML(proposal);
  const baselineYaml = readBaselineYAML(opts.specsDir);

  // AC-STE-303.6 — idempotent re-entry no-op.
  if (isProposalNoOp(baselineYaml, proposalYaml)) {
    return { outcome: "unchanged" };
  }

  // AC-STE-303.5 — auto-approve marker bypass.
  if (opts.autoApprove) {
    opts.deps.writeTrackerConfig(opts.specsDir, proposalToConfig(proposal));
    return { outcome: "succeeded" };
  }

  // AC-STE-303.5 — approve / edit / cancel via AskUserQuestion.
  const diff = renderUnifiedDiff(baselineYaml, proposalYaml);
  const answer = await opts.deps.askUserQuestion({
    kind: "tracker_config_proposal",
    diff,
    proposal_yaml: proposalYaml,
    options: ["approve", "edit", "cancel"],
  });

  const choice = (answer["choice"] ?? "") as string;

  if (choice === "cancel") {
    return { outcome: "cancelled" };
  }

  if (choice === "edit") {
    // AC-STE-303.5 — edit branch: per-role manual pick. Re-ask for every
    // canonical role; the operator picks from the verbatim statuses list.
    const editedRoles: Record<string, string> = {};
    for (const role of CANONICAL_ROLES) {
      const perRole = await opts.deps.askUserQuestion({
        kind: "tracker_config_per_role_pick",
        role,
        statuses,
        current: proposal.roles[role],
      });
      const picked = (perRole["status"] ?? "") as string;
      editedRoles[role] = picked;
    }
    const edited: Proposal = {
      ...proposal,
      roles: { ...editedRoles },
    };
    opts.deps.writeTrackerConfig(opts.specsDir, proposalToConfig(edited));
    return { outcome: "succeeded" };
  }

  // approve (or unrecognized → treat as approve since AskUserQuestion is
  // closed-form; an unknown answer never reaches this path under the test
  // contract).
  opts.deps.writeTrackerConfig(opts.specsDir, proposalToConfig(proposal));
  return { outcome: "succeeded" };
}

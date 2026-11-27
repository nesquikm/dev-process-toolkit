// gate_probe_runner (STE-756) — runs every /gate-check probe whose
// registration calls it with `projectRoot` as its only argument, in
// registration order, and prints one row per probe then the summary line.
//
//   bun gate_probe_runner.ts <projectRoot>
//
// It adds no probe semantics: each row comes from the probe's own report.
// The imports are static so probe #81 (module_reachability) sees the edges.

import { deriveProbeOutcome, renderProbeRow, type ProbeSeverity } from "./gate_probe_rows.ts";
import { runNavContractProbe } from "./docs_nav_contract.ts";
import { runIdentityModeConditionalProbe } from "./identity_mode_conditional.ts";
import { runArchivePlanStatusProbe } from "./archive_plan_status.ts";
import { runSetupOutputCompletenessProbe } from "./setup_output_completeness.ts";
import { runClaudeMdDocsSectionProbe } from "./claudemd_docs_section.ts";
import { runSetupAuditSectionPresenceProbe } from "./setup_audit_section_presence.ts";
import { runBunZeroMatchPlaceholderProbe } from "./bun_zero_match_placeholder.ts";
import { runTaskTrackingCanonicalKeysProbe } from "./task_tracking_canonical_keys.ts";
import { runToolkitBootstrapCommittedProbe } from "./toolkit_bootstrap_committed.ts";
import { runTraceabilityLinkValidityProbe } from "./traceability_link_validity.ts";
import { runSignatureStrategyHonorsSetupProbe } from "./signature_strategy_honors_setup.ts";
import { runTaskTrackingWorkspaceBindingPresentProbe } from "./task_tracking_workspace_binding_present.ts";
import { runFrontmatterMilestoneNotArchivedProbe } from "./frontmatter_milestone_not_archived.ts";
import { runPlanVerifyLineValidityProbe } from "./plan_verify_line_validity.ts";
import { runRequirementsMdNoPlaceholderProbe } from "./requirements_md_no_placeholder.ts";
import { runSetupBootstrapCommitSubjectProbe } from "./setup_bootstrap_commit_subject.ts";
import { runImplementInvocationGrammarDocProbe } from "./implement_invocation_grammar_doc.ts";
import { runPlanFileSingleMilestoneProbe } from "./plan_file_single_milestone.ts";
import { runPlanTaskFrCoverageProbe } from "./plan_task_fr_coverage.ts";
import { runMcpConfigShapeProbe } from "./mcp_config_shape.ts";
import { runSetupPermissionsShapeProbe } from "./setup_permissions_shape.ts";
import { runArchiveFrontmatterCoherentProbe } from "./archive_frontmatter_coherent.ts";
import { runCrossCuttingSpecStaleFileRefsProbe } from "./cross_cutting_spec_stale_file_refs.ts";
import { runAutoApproveMarkerProbe } from "./auto_approve_marker.ts";
import { runTddOrchestratorIntegrityProbe } from "./tdd_orchestrator_integrity.ts";
import { runNeedsTechnicalReviewConsistencyProbe } from "./needs_technical_review_consistency.ts";
import { runSpecResearchResultShapeProbe } from "./spec_research_result_shape.ts";
import { runRequiresInputSentinelCoverageProbe } from "./requires_input_sentinel_coverage.ts";
import { runSocraticLoopUsesAskUserQuestionProbe } from "./socratic_loop_uses_ask_user_question.ts";
import { runClosingSummaryCapabilityKeysProbe } from "./closing_summary_capability_keys.ts";
import { runSocraticFirstTurnPostHocDriftProbe } from "./socratic_first_turn_post_hoc_drift.ts";
import { runConformanceLoopBypassRemovedProbe } from "./conformance_loop_bypass_removed.ts";
import { runSpecWriteFirstTurnDriftScanProbe } from "./spec_write_first_turn_drift_scan.ts";
import { runSpecWriteAlternateTriggerScanProbe } from "./spec_write_alternate_trigger_scan.ts";
import { runTddSpecReviewerInvariantsProbe } from "./tdd_spec_reviewer_invariants.ts";
import { runDepsResearcherInvariantsProbe } from "./deps_researcher_invariants.ts";
import { runTrackerConfigShapeProbe } from "./tracker_config_shape.ts";
import { runTrackerToleranceWrapperPresentProbe } from "./tracker_tolerance_wrapper_present.ts";
import { runAuditFixLoopPatternInvariantsProbe } from "./audit_fix_loop_pattern.ts";
import { runNotATriggerAnchorPresentProbe } from "./not_a_trigger_anchor_present.ts";
import { runPublicSurfaceCountDriftProbe } from "./public_surface_count_drift.ts";
import { runCrossSkillContractDriftProbe } from "./cross_skill_contract_drift.ts";
import { runDisableModelInvocationAllowlistProbe } from "./disable_model_invocation_allowlist.ts";
import { runKotlinDetektConfiguredProbe } from "./kotlin_detekt_configured.ts";
import { scanDesignReferences } from "./scan_design_references.ts";
import { runSpawnPatternAllowlistProbe } from "./spawn_pattern_allowlist.ts";
import { runPlanShipCoherenceProbe } from "./plan_ship_coherence.ts";
import { runDepsResearchResultShapeProbe } from "./deps_research_result_shape.ts";
import { runDepsResearchDispositionContractProbe } from "./deps_research_disposition_contract.ts";
import { runSpecWriteNextLineDocProbe } from "./spec_write_next_line_doc.ts";
import { runFrSummaryAltitudeProbe } from "./scan_fr_summary_altitude.ts";
import { runPlanNarrativeAltitudeProbe } from "./scan_plan_narrative_altitude.ts";
import { runMigrationCoverageProbe } from "./migrations/coverage.ts";
import { runUpgradeStalenessProbe } from "./upgrade_staleness.ts";
import { runSpecWriteMilestoneGateRoutedProbe } from "./spec_write_milestone_gate_routed.ts";
import { runReportIssuePublishGateMarkerProbe } from "./report_issue_publish_gate_marker.ts";
import { runSpecWriteFirstTurnTrackerCreateClauseProbe } from "./spec_write_first_turn_tracker_create_clause.ts";
import { runPlanIdentityModeConditionalProbe } from "./plan_identity_mode_conditional.ts";
import { runClaudeMdProbeManagedGuardProbe } from "./claudemd_probe_managed_guard.ts";
import { runActivePlanShipReadyProbe } from "./active_plan_ship_ready.ts";
import { runBestPracticesManifestHygieneProbe } from "./best_practices_manifest_hygiene.ts";
import { runBestPracticesDigestMatchProbe } from "./best_practices_digest_match.ts";
import { runFirstTurnRefusalMarkerProbe } from "./first_turn_refusal_marker.ts";
import { runDelegationIrreversibleExclusionProbe } from "./delegation_irreversible_exclusion.ts";
import { runMergePolicyOverrideRatchetProbe } from "./merge_policy_override_ratchet.ts";
import { runRunnabilityDeclaredProbe } from "./runnability_declared.ts";
import { runModuleReachabilityProbe } from "./module_reachability.ts";
import { runStageBlockAdoptionProbe } from "./stage_block_adoption.ts";
import { runExternalLinkVerdictsProbe } from "./external_link_verdicts.ts";
import { runDrivenSuppressionAdoptionProbe } from "./inline_terminal_block.ts";
import { runContinuationOfferAdoptionProbe } from "./continuation_offer.ts";
import { runMilestoneNameUnaskedProbe } from "./milestone_name_unasked.ts";
import { runVideoToolingUncommittedProbe } from "./video_tooling_uncommitted.ts";
import { runBugFrShapeProbe } from "./bug_fr_shape.ts";
import { runTrackerWriteGateSettingProbe } from "./tracker_write_gate_setting.ts";
import { runOptimizationsReuseOnlyProbe } from "./optimizations_config.ts";

export interface GateProbeEntry {
  n: number;
  id: string;
  severity: ProbeSeverity;
  run: (projectRoot: string) => unknown;
  /** Set on #62 only: its notes explain its own vacuity, so a vacuous report with notes stays `vacuous`. */
  vacuityNotes?: true;
}

/**
 * Probe #61's violations: `scanDesignReferences` returns every row it read,
 * resolved ones included, and only a row with `resolves === false` fails.
 */
function unresolvedDesignReferences(projectRoot: string) {
  return scanDesignReferences(projectRoot).filter((row) => row.resolves === false);
}

/**
 * Probe #67 is two calls: the FR half and, as its own second call, the plan
 * half. Their violations are concatenated with each row's own severity kept,
 * and the probe is vacuous only when both halves are.
 */
async function frSummaryAndPlanNarrativeAltitude(projectRoot: string) {
  const fr = await runFrSummaryAltitudeProbe(projectRoot);
  const plan = await runPlanNarrativeAltitudeProbe(projectRoot);
  return {
    violations: [...fr.violations, ...plan.violations],
    vacuous: fr.vacuous && plan.vacuous,
  };
}

export const GATE_PROBES: GateProbeEntry[] = [
  { n: 12, id: "docs-nav-contract", severity: "error", run: runNavContractProbe },
  { n: 13, id: "identity-mode-conditional", severity: "error", run: runIdentityModeConditionalProbe },
  { n: 16, id: "archive-plan-status", severity: "error", run: runArchivePlanStatusProbe },
  { n: 17, id: "setup-output-completeness", severity: "error", run: runSetupOutputCompletenessProbe },
  { n: 18, id: "claudemd-docs-section-present", severity: "error", run: runClaudeMdDocsSectionProbe },
  { n: 19, id: "setup-audit-section-presence", severity: "error", run: runSetupAuditSectionPresenceProbe },
  { n: 20, id: "bun-zero-match-placeholder", severity: "error", run: runBunZeroMatchPlaceholderProbe },
  { n: 21, id: "task-tracking-canonical-keys", severity: "error", run: runTaskTrackingCanonicalKeysProbe },
  { n: 22, id: "toolkit-bootstrap-committed", severity: "error", run: runToolkitBootstrapCommittedProbe },
  { n: 23, id: "traceability-link-validity", severity: "error", run: runTraceabilityLinkValidityProbe },
  { n: 24, id: "signature-strategy-honors-setup", severity: "error", run: runSignatureStrategyHonorsSetupProbe },
  { n: 25, id: "task-tracking-workspace-binding-present", severity: "error", run: runTaskTrackingWorkspaceBindingPresentProbe },
  { n: 27, id: "frontmatter-milestone-not-archived", severity: "error", run: runFrontmatterMilestoneNotArchivedProbe },
  { n: 28, id: "plan-verify-line-validity", severity: "warning", run: runPlanVerifyLineValidityProbe },
  { n: 29, id: "requirements-md-no-placeholder", severity: "warning", run: runRequirementsMdNoPlaceholderProbe },
  { n: 30, id: "setup-bootstrap-commit-subject", severity: "error", run: runSetupBootstrapCommitSubjectProbe },
  { n: 31, id: "implement-invocation-grammar-doc", severity: "error", run: runImplementInvocationGrammarDocProbe },
  { n: 32, id: "plan-file-single-milestone", severity: "warning", run: runPlanFileSingleMilestoneProbe },
  { n: 33, id: "plan-task-fr-coverage", severity: "warning", run: runPlanTaskFrCoverageProbe },
  { n: 34, id: "mcp-config-shape", severity: "error", run: runMcpConfigShapeProbe },
  { n: 35, id: "setup-permissions-shape", severity: "note", run: runSetupPermissionsShapeProbe },
  { n: 36, id: "archive-frontmatter-coherent", severity: "error", run: runArchiveFrontmatterCoherentProbe },
  { n: 37, id: "cross-cutting-spec-stale-file-refs", severity: "warning", run: runCrossCuttingSpecStaleFileRefsProbe },
  { n: 38, id: "auto-approve-marker-in-canonical-spawns", severity: "error", run: runAutoApproveMarkerProbe },
  { n: 39, id: "tdd-orchestrator-integrity", severity: "error", run: runTddOrchestratorIntegrityProbe },
  { n: 40, id: "needs_technical_review_consistency", severity: "error", run: runNeedsTechnicalReviewConsistencyProbe },
  { n: 41, id: "spec_research_result_shape", severity: "error", run: runSpecResearchResultShapeProbe },
  { n: 42, id: "requires_input_sentinel_coverage", severity: "error", run: runRequiresInputSentinelCoverageProbe },
  { n: 43, id: "socratic_loop_uses_ask_user_question", severity: "error", run: runSocraticLoopUsesAskUserQuestionProbe },
  { n: 44, id: "closing_summary_capability_keys", severity: "error", run: runClosingSummaryCapabilityKeysProbe },
  { n: 45, id: "socratic_first_turn_post_hoc_drift", severity: "error", run: runSocraticFirstTurnPostHocDriftProbe },
  { n: 46, id: "conformance-loop-bypass-removed", severity: "error", run: runConformanceLoopBypassRemovedProbe },
  { n: 47, id: "spec_write_first_turn_drift_scan", severity: "error", run: runSpecWriteFirstTurnDriftScanProbe },
  { n: 48, id: "spec_write_marker_alternate_trigger_scan", severity: "error", run: runSpecWriteAlternateTriggerScanProbe },
  { n: 50, id: "tdd_spec_reviewer_subagent_invariants", severity: "error", run: runTddSpecReviewerInvariantsProbe },
  { n: 51, id: "deps_researcher_subagent_invariants", severity: "error", run: runDepsResearcherInvariantsProbe },
  { n: 52, id: "tracker_config_shape", severity: "error", run: runTrackerConfigShapeProbe },
  { n: 53, id: "tracker_tolerance_wrapper_present", severity: "error", run: runTrackerToleranceWrapperPresentProbe },
  { n: 54, id: "audit_fix_loop_pattern_invariants", severity: "error", run: runAuditFixLoopPatternInvariantsProbe },
  { n: 55, id: "not_a_trigger_anchor_present", severity: "error", run: runNotATriggerAnchorPresentProbe },
  { n: 57, id: "public_surface_count_drift", severity: "error", run: runPublicSurfaceCountDriftProbe },
  { n: 58, id: "cross_skill_contract_drift", severity: "error", run: runCrossSkillContractDriftProbe },
  { n: 59, id: "disable_model_invocation_allowlist", severity: "error", run: runDisableModelInvocationAllowlistProbe },
  { n: 60, id: "kotlin-detekt-configured", severity: "error", run: runKotlinDetektConfiguredProbe },
  { n: 61, id: "design_references_resolve", severity: "error", run: unresolvedDesignReferences },
  { n: 62, id: "spawn_pattern_allowlist", severity: "error", vacuityNotes: true, run: runSpawnPatternAllowlistProbe },
  { n: 63, id: "plan_ship_coherence", severity: "error", run: runPlanShipCoherenceProbe },
  { n: 64, id: "deps_research_result_shape", severity: "error", run: runDepsResearchResultShapeProbe },
  { n: 65, id: "deps_research_disposition_contract", severity: "error", run: runDepsResearchDispositionContractProbe },
  { n: 66, id: "spec_write_next_line_doc", severity: "error", run: runSpecWriteNextLineDocProbe },
  { n: 67, id: "fr_summary_altitude", severity: "error", run: frSummaryAndPlanNarrativeAltitude },
  { n: 68, id: "migration_coverage", severity: "error", run: runMigrationCoverageProbe },
  { n: 69, id: "upgrade_staleness", severity: "note", run: runUpgradeStalenessProbe },
  { n: 70, id: "spec_write_milestone_gate_routed", severity: "error", run: runSpecWriteMilestoneGateRoutedProbe },
  { n: 71, id: "report_issue_publish_gate_marker", severity: "error", run: runReportIssuePublishGateMarkerProbe },
  { n: 72, id: "spec_write_first_turn_tracker_create_clause", severity: "error", run: runSpecWriteFirstTurnTrackerCreateClauseProbe },
  { n: 73, id: "plan_identity_mode_conditional", severity: "error", run: runPlanIdentityModeConditionalProbe },
  { n: 74, id: "claudemd_probe_managed_guard", severity: "error", run: runClaudeMdProbeManagedGuardProbe },
  { n: 75, id: "active_plan_ship_ready", severity: "warning", run: runActivePlanShipReadyProbe },
  { n: 76, id: "best_practices_manifest_hygiene", severity: "error", run: runBestPracticesManifestHygieneProbe },
  { n: 77, id: "first_turn_refusal_marker", severity: "error", run: runFirstTurnRefusalMarkerProbe },
  { n: 78, id: "delegation_irreversible_exclusion", severity: "error", run: runDelegationIrreversibleExclusionProbe },
  { n: 79, id: "merge_policy_override_ratchet", severity: "error", run: runMergePolicyOverrideRatchetProbe },
  { n: 80, id: "runnability_declared", severity: "error", run: runRunnabilityDeclaredProbe },
  { n: 81, id: "module_reachability", severity: "error", run: runModuleReachabilityProbe },
  { n: 82, id: "stage_block_adoption", severity: "error", run: runStageBlockAdoptionProbe },
  { n: 83, id: "external_link_verdicts", severity: "error", run: runExternalLinkVerdictsProbe },
  { n: 84, id: "driven_suppression_adoption", severity: "error", run: runDrivenSuppressionAdoptionProbe },
  { n: 85, id: "continuation_offer_adoption", severity: "error", run: runContinuationOfferAdoptionProbe },
  { n: 86, id: "milestone_name_unasked", severity: "error", run: runMilestoneNameUnaskedProbe },
  { n: 87, id: "video_tooling_uncommitted", severity: "warning", run: runVideoToolingUncommittedProbe },
  { n: 88, id: "bug_fr_shape", severity: "error", run: runBugFrShapeProbe },
  { n: 89, id: "tracker_write_gate_setting", severity: "note", run: runTrackerWriteGateSettingProbe },
  { n: 90, id: "optimizations_reuse_only", severity: "error", run: runOptimizationsReuseOnlyProbe },
  { n: 91, id: "best_practices_digest_match", severity: "error", run: runBestPracticesDigestMatchProbe },
];

interface NormalisedReport {
  count: number;
  vacuous: boolean;
  reportSeverity?: string;
  violationSeverities: (string | undefined)[];
  notesCount: number;
}

/** The `severity` each violation carries, `undefined` where it carries none. */
function severitiesOf(violations: unknown[]): (string | undefined)[] {
  return violations.map((v) => {
    const sev = (v as { severity?: unknown } | null)?.severity;
    return typeof sev === "string" ? sev : undefined;
  });
}

/** How many entries one report list holds, zero when it is not a list. */
function listLength(list: unknown): number {
  return Array.isArray(list) ? list.length : 0;
}

/**
 * Read `violations`, `vacuous`, `severity`, `notes` and `warnings` off a
 * probe's own report. A report that is not an array, has no `violations`
 * array and no boolean `ok` is a shape the runner does not know: it throws,
 * so the row reads `fail (error: unexpected report shape)` and never `pass`.
 */
function normaliseReport(report: unknown): NormalisedReport {
  if (Array.isArray(report)) {
    return {
      count: report.length,
      vacuous: false,
      violationSeverities: severitiesOf(report),
      notesCount: 0,
    };
  }
  const r = (typeof report === "object" && report !== null ? report : {}) as Record<string, unknown>;
  if (!Array.isArray(r.violations) && typeof r.ok !== "boolean") {
    throw new Error("unexpected report shape");
  }
  let count = 0;
  let violationSeverities: (string | undefined)[] = [];
  let notesCount = listLength(r.notes) + listLength(r.warnings);
  if (Array.isArray(r.violations)) {
    count = r.violations.length;
    violationSeverities = severitiesOf(r.violations);
  }
  if (r.ok === false && count === 0) {
    // A report that says it failed is never a pass, even with an empty `violations` list.
    // An `ok`-shaped report (#12, #24) lists its violations as `notes`.
    count = Math.max(listLength(r.notes), 1);
    notesCount = 0;
  }
  return {
    count,
    vacuous: r.vacuous === true || r.skipped === true,
    reportSeverity: typeof r.severity === "string" ? r.severity : undefined,
    violationSeverities,
    notesCount,
  };
}

export interface GateProbeRun {
  rows: string[];
  summary: string;
  exitCode: number;
}

export async function runGateProbes(
  projectRoot: string,
  table: GateProbeEntry[] = GATE_PROBES,
): Promise<GateProbeRun> {
  const rows: string[] = [];
  let passed = 0;
  let vacuous = 0;
  let failed = false;
  for (const e of table) {
    try {
      const rep = normaliseReport(await e.run(projectRoot));
      const { verdict, count } = deriveProbeOutcome({ ...rep, severity: e.severity, vacuityNotes: e.vacuityNotes === true });
      if (verdict === "fail") failed = true;
      else passed++;
      if (verdict === "vacuous") vacuous++;
      rows.push(renderProbeRow({ n: e.n, id: e.id, verdict, count }));
    } catch (err) {
      failed = true;
      const msg = String(err instanceof Error ? err.message : err).split("\n")[0]!.trim();
      rows.push(renderProbeRow({ n: e.n, id: e.id, verdict: "fail", count: 0, error: msg }));
    }
  }
  const total = table.length;
  const summary = `conformance-probes pass: ${passed}/${total} [${total - vacuous} active, ${vacuous} vacuous]`;
  return { rows, summary, exitCode: failed ? 1 : 0 };
}

if (import.meta.main) {
  const projectRoot = process.argv[2];
  if (!projectRoot) {
    console.error("usage: bun gate_probe_runner.ts <projectRoot>");
    process.exit(2);
  }
  const out = await runGateProbes(projectRoot);
  for (const row of out.rows) console.log(row);
  console.log(out.summary);
  process.exit(out.exitCode);
}

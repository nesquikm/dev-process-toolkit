// claudemd_probe_managed_guard (STE-434, M118) — /gate-check probe #74.
// Severity: error.
//
// The structural fuse behind STE-432. Every module under
// `adapters/_shared/src/` that resolves a CLAUDE.md path must either route the
// "is this tree toolkit-managed?" question through the one shared predicate
// (`./toolkit_managed`), or be named in `CLAUDEMD_GUARD_EXEMPT` with a
// recorded one-line reason. Probe #18 drifted to guarding on nothing precisely
// because that question was re-derived by hand in five places; from here on an
// omission has to be a decision.
//
// Selection  — `<adaptersSrcDir>/*.ts`, excluding `*.test.ts`, whose body
//              resolves a CLAUDE.md path (see `CLAUDE_MD_JOIN_RE`).
// Compliance — the body imports from `./toolkit_managed`, OR the module id
//              (basename minus `.ts`) is a key in `CLAUDEMD_GUARD_EXEMPT`.
// Vacuous    — neither `<projectRoot>/plugins/dev-process-toolkit/adapters/
//              _shared/src` nor `<projectRoot>/adapters/_shared/src` exists.
//              Downstream consumers do not vendor the shared adapter layer, so
//              there is nothing to guard there.
//
// Allowlist-driven scan, mirroring probe #54 `audit_fix_loop_pattern`.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  pushViolation as pushViolationShared,
  type IntegrityViolation,
  type Severity,
} from "./tdd_probe_helpers";

export type { Severity };

export const PROBE_ID = "claudemd_probe_managed_guard";

/**
 * Modules whose CLAUDE.md read is NOT a managed-ness question.
 *
 * An entry here records one specific claim: *this module's applicability does
 * not derive from whether the tree is toolkit-managed*. It derives from the
 * declared tracker `mode:`, from a docs-mode flag, from a sibling file's
 * existence, or the file is simply an input document whose bytes are being
 * checked. Routing such a module through `isToolkitManaged` would change its
 * semantics, not tidy them.
 *
 * An exemption is emphatically NOT "this module is allowed to be wrong". It is
 * a recorded decision with a real reason, reviewable on its own line. The two
 * other ways out of a violation are to drop the CLAUDE.md read entirely, or to
 * route it through `./toolkit_managed`.
 */
export const CLAUDEMD_GUARD_EXEMPT: Record<string, string> = {
  bun_zero_match_placeholder:
    "applicability is `bun.lock`; CLAUDE.md is read only for the `## Testing Conventions` layout policy, not for managed-ness.",
  detect_runnability:
    "CLAUDE.md is an INPUT DOCUMENT whose headings are scanned for a run block; applicability is the presence of run instructions, not managed-ness.",
  docs_nav_contract:
    "validates the `docs/README.md` nav contract; CLAUDE.md is read for the Schema-D docs mode flags, not managed-ness.",
  evidence_required_sections:
    "applicability derives from the declared `## Verification` block (`run_cmd` / `e2e_cmd`), read via `readVerificationConfig`; an absent block declares nothing and yields the unconditional gate section in managed and unmanaged trees alike.",
  identity_mode_conditional:
    "applicability derives from the declared tracker `mode:`, read via `readTaskTrackingSection`.",
  orchestration_config:
    "applicability derives from the presence of the `## Orchestration` section it parses; absent section or file returns defaults even in unmanaged trees.",
  plan_identity_mode_conditional:
    "applicability derives from the declared tracker `mode:`, read via `readTaskTrackingSection`.",
  public_surface_count_drift:
    "CLAUDE.md is an INPUT DOCUMENT whose documented count tokens are being byte-checked, not a managed-ness signal.",
  release_config:
    "applicability derives from the declared `## Release Files` block its front door parses; an absent block already refuses with `MissingReleaseFilesBlockError`, so managed-ness would only add a second gate that refuses trees the block itself declares in scope.",
  release_surface_agreement:
    "applicability derives from the declared `changelog_ci_owned` docs flag, read via `readDocsConfig` — the same reader `release_config` consults before it skips the CHANGELOG entry; managed-ness would gate the grader differently from the writer it must agree with.",
  setup_output_completeness:
    "applicability derives from the declared tracker `mode:` (any value other than `none`).",
  task_tracking_canonical_keys:
    "applicability derives from the presence of the `## Task Tracking` section it parses.",
  task_tracking_workspace_binding_present:
    "applicability derives from the declared tracker `mode:` (vacuous on absent section or `mode: none`).",
  toolkit_managed:
    "IS the shared managed-ness predicate — the one module every other in-scope module is required to route through.",
  tracker_config_shape:
    "applicability derives from `specs/tracker-config.yaml`; CLAUDE.md is read only for the declared `mode:` short-circuit and the adapter cross-check.",
  tracker_project_milestone_attached:
    "applicability derives from the declared tracker `mode:` and the per-FR `tracker:` blocks it walks.",
};

/**
 * A body is IN SCOPE when it resolves a CLAUDE.md path.
 *
 * Deliberately a path-join shape rather than the bare filename: a module that
 * only *mentions* CLAUDE.md in prose or in remedy text (probe #54's remedies
 * do exactly that) is not consulting the file and has no managed-ness question
 * to route.
 */
const CLAUDE_MD_JOIN_RE = /join\s*\([^)]*["']CLAUDE\.md["']/;

// Self-scan note: this module lives in the scanned directory and is scanned
// like every sibling. It is NOT selected today, for an incidental reason — the
// pattern above is a regex literal whose paren is escaped, so its own source
// text never forms the shape it looks for. Nothing designs that; a prose
// example of the real path-join shape added anywhere in this file WOULD select
// it, and since it neither imports `./toolkit_managed` nor holds a key in
// `CLAUDEMD_GUARD_EXEMPT`, the guard would flag itself. Keep the literal shape
// out of this file's comments. Deliberately no dormant exemption key for this
// module: an exemption that exempts nothing is a false record.

/** A body COMPLIES when it pulls the shared predicate in from `./toolkit_managed`. */
const TOOLKIT_MANAGED_IMPORT_RE = /from\s+["']\.\/toolkit_managed(?:\.[jt]s)?["']/;

/** Candidate adapter-source roots, in resolution order (first existing wins). */
const ADAPTER_SRC_CANDIDATES: ReadonlyArray<ReadonlyArray<string>> = [
  ["plugins", "dev-process-toolkit", "adapters", "_shared", "src"],
  ["adapters", "_shared", "src"],
];

export interface ClaudeMdGuardViolation {
  file: string;
  line: number;
  severity: Severity;
  note: string;
  message: string;
}

export interface ClaudeMdGuardReport {
  violations: ClaudeMdGuardViolation[];
  vacuous: boolean;
}

function buildMessage(noteBody: string, file: string): string {
  return [
    `${PROBE_ID}: ${noteBody}`,
    "Remedy: pick one of three. (a) Route the managed-ness question through " +
      "the shared predicate — `import { isToolkitManaged } from " +
      '"./toolkit_managed"` — instead of re-deriving it from CLAUDE.md by ' +
      "hand. (b) If this module's applicability genuinely does not derive " +
      "from managed-ness (it derives from a tracker `mode:`, a docs-mode " +
      "flag, a sibling file, or CLAUDE.md is an input document being " +
      "byte-checked), add its module id to `CLAUDEMD_GUARD_EXEMPT` in " +
      "`adapters/_shared/src/claudemd_probe_managed_guard.ts` with a one-line " +
      "reason. (c) Drop the CLAUDE.md read. An exemption is a recorded " +
      "decision, not permission to be wrong.",
    `Context: file=${file}, probe=${PROBE_ID}, severity=error`,
  ].join("\n");
}

function pushViolation(
  out: IntegrityViolation[],
  projectRoot: string,
  absFile: string,
  line: number,
  reason: string,
): void {
  pushViolationShared(out, projectRoot, absFile, line, reason, buildMessage);
}

/** 1-based line number of `re`'s first match in `body`; 1 when it does not match. */
function lineOfMatch(body: string, re: RegExp): number {
  const m = re.exec(body);
  if (m === null) return 1;
  return body.slice(0, m.index).split("\n").length;
}

/**
 * The shared adapter-source directory under `projectRoot`, or `null` when the
 * project does not ship one (⇒ the probe is vacuous).
 */
function resolveAdapterSrc(projectRoot: string): string | null {
  for (const segments of ADAPTER_SRC_CANDIDATES) {
    const candidate = join(projectRoot, ...segments);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Non-test `*.ts` module file names under `srcDir`, sorted for determinism. */
function listModules(srcDir: string): string[] {
  let entries;
  try {
    entries = readdirSync(srcDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".ts") && !e.name.endsWith(".test.ts"))
    .map((e) => e.name)
    .sort();
}

export async function runClaudeMdProbeManagedGuardProbe(
  projectRoot: string,
): Promise<ClaudeMdGuardReport> {
  const srcDir = resolveAdapterSrc(projectRoot);
  if (srcDir === null) return { violations: [], vacuous: true };

  const violations: IntegrityViolation[] = [];

  for (const name of listModules(srcDir)) {
    const absFile = join(srcDir, name);
    let body: string;
    try {
      body = readFileSync(absFile, "utf-8");
    } catch (err) {
      // Fail closed: a module in the shared adapter layer that cannot be read
      // cannot be shown to route its managed-ness question anywhere.
      pushViolation(
        violations,
        projectRoot,
        absFile,
        1,
        `module is not readable, so its CLAUDE.md routing cannot be verified: ${(err as Error).message}`,
      );
      continue;
    }

    // ── selection ──
    if (!CLAUDE_MD_JOIN_RE.test(body)) continue;

    // ── compliance ──
    const moduleId = name.slice(0, -".ts".length);
    if (TOOLKIT_MANAGED_IMPORT_RE.test(body)) continue;
    if (Object.hasOwn(CLAUDEMD_GUARD_EXEMPT, moduleId)) continue;

    pushViolation(
      violations,
      projectRoot,
      absFile,
      lineOfMatch(body, CLAUDE_MD_JOIN_RE),
      `resolves a CLAUDE.md path without importing the shared managed-ness ` +
        `predicate from \`./toolkit_managed\`, and \`${moduleId}\` is not a ` +
        `recorded entry in \`CLAUDEMD_GUARD_EXEMPT\``,
    );
  }

  // Map IntegrityViolation → ClaudeMdGuardViolation (drop the `reason` field).
  return {
    violations: violations.map((v) => ({
      file: v.file,
      line: v.line,
      severity: v.severity,
      note: v.note,
      message: v.message,
    })),
    vacuous: false,
  };
}

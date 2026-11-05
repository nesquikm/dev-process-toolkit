// workspace_binding — STE-117 AC-STE-117.6.
//
// Reads `### Linear` / `### Jira` Schema L sub-section under `## Task Tracking`
// in CLAUDE.md. Returns `{}` when the file/section/sub-section is absent or
// the binding is empty (mode-none equivalent: callers downstream — adapters,
// `/spec-write`, `/implement` — treat `{}` as "no workspace context", and
// the gate-check probe `task-tracking-workspace-binding-present` (#25)
// hard-fails tracker mode without a populated binding).
//
// Parser scope (AC-STE-117.1):
//   - sub-section starts at `### Linear` / `### Jira` heading and ends at
//     the next `##`/`###` heading or EOF (greedy);
//   - keys mirror Schema L top-level shape (`key: value`);
//   - `default_labels:` is a YAML inline array `[a, b, "c"]` parsed into
//     string[] (caller-facing as `defaultLabels` to honor the canonical
//     camelCase TS surface);
//   - whitespace-only / empty values surface as missing keys so the probe
//     is the single decision point on absence.

import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { checkVersionFloor, runningDptVersion } from "./dpt_version";
import { SETTINGS_FILE, viewProjectSection } from "./project_settings";
import {
  parseBindingSubsection,
  refuseBinding as refuse,
  validateBindingDeclaration,
  type WorkspaceAdapterKey,
  type WorkspaceBinding,
} from "./project_settings_legacy";
import { readTaskTrackingSection } from "./resolver_config";

export {
  locateSubsection,
  type WorkspaceAdapterKey,
  type WorkspaceBinding,
  WorkspaceBindingError,
} from "./project_settings_legacy";

/**
 * STE-707 — derived from `loadProjectSection(projectRoot, "task_tracking")`
 * with the project root resolved as the directory of `claudeMdPath`: on a
 * settings-file tree the `task_tracking.<adapter>` mapping, held to the same
 * declaration rules; on a legacy tree the v2.101.4 sub-section parse, whose
 * line grammar lives in the loader's legacy module.
 */
export function readWorkspaceBinding(
  claudeMdPath: string,
  adapterKey: WorkspaceAdapterKey,
): WorkspaceBinding {
  return viewProjectSection(
    dirname(claudeMdPath),
    "task_tracking",
    (tt) => bindingFromSettings(tt[adapterKey], adapterKey),
    () => readLegacyBinding(claudeMdPath, adapterKey),
  );
}

function readLegacyBinding(claudeMdPath: string, adapterKey: WorkspaceAdapterKey): WorkspaceBinding {
  if (!existsSync(claudeMdPath)) return { shared: false };
  const context = `file=${basename(claudeMdPath)}, adapter=${adapterKey}, helper=readWorkspaceBinding`;
  let content: string;
  try {
    content = readFileSync(claudeMdPath, "utf-8");
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? "unknown";
    refuse(
      `CLAUDE.md at ${claudeMdPath} exists but cannot be read (${code}) — the shared-container declaration cannot be verified.`,
      `make ${claudeMdPath} a readable regular file, or remove it.`,
      `${context}, path=${claudeMdPath}, error=${code}`,
    );
  }
  const parsed = parseBindingSubsection(content, adapterKey);
  if (!parsed) return { shared: false };
  return finishBinding(parsed.result, parsed.occurrences, context);
}

/** The one validation pass and the binding's final shape, for both homes. */
function finishBinding(
  result: Omit<WorkspaceBinding, "shared">,
  occurrences: Record<string, string[]>,
  context: string,
): WorkspaceBinding {
  validateBindingDeclaration(result, occurrences, context);
  return { ...result, shared: result.repoTag !== undefined };
}

/** The settings-file binding mapping in the reader's camelCase shape; empty values read as absent. */
function bindingFromSettings(raw: unknown, adapterKey: WorkspaceAdapterKey): WorkspaceBinding {
  if (typeof raw !== "object" || raw === null) return { shared: false };
  const b = raw as Record<string, unknown>;
  const str = (k: string): string | undefined => {
    const v = b[k];
    return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
  };
  const result: Omit<WorkspaceBinding, "shared"> = {};
  const set = <K extends keyof typeof result>(k: K, v: (typeof result)[K] | undefined): void => {
    if (v !== undefined) result[k] = v;
  };
  set("team", str("team"));
  set("project", str("project"));
  if (Array.isArray(b.default_labels)) result.defaultLabels = (b.default_labels as string[]).filter((l) => l.length > 0);
  set("repoTag", str("repo_tag"));
  set("minDptVersion", str("min_dpt_version"));
  if (adapterKey === "jira") set("jiraBugIssueType", str("jira_bug_issue_type"));
  if (adapterKey === "linear") set("linearBugLabel", str("linear_bug_label"));
  const context = `file=${SETTINGS_FILE}, key=task_tracking.${adapterKey}, adapter=${adapterKey}, helper=readWorkspaceBinding`;
  return finishBinding(result, {}, context);
}

/**
 * STE-679 — the tracker-side bug type for a `--bug` create: the mode's
 * override when declared, `Bug` otherwise, `null` for `mode: none`.
 */
export function resolveBugTrackerType(
  mode: WorkspaceAdapterKey | "none",
  binding: Pick<WorkspaceBinding, "jiraBugIssueType" | "linearBugLabel">,
): string | null {
  if (mode === "jira") return binding.jiraBugIssueType ?? "Bug";
  if (mode === "linear") return binding.linearBugLabel ?? "Bug";
  return null;
}

/**
 * STE-602 — the front door: `bun run adapters/_shared/src/workspace_binding.ts <projectRoot>`.
 * Resolves the active mode, prints the binding as one JSON line and
 * `running=<version> floor=<ok|refused>`; a malformed declaration exits 1
 * with the refusal on stderr and nothing on stdout.
 */
if (import.meta.main) {
  const root = process.argv[2] ?? process.cwd();
  const claudeMdPath = join(root, "CLAUDE.md");
  try {
    const mode = readTaskTrackingSection(claudeMdPath)["mode"];
    const binding: WorkspaceBinding =
      mode === "linear" || mode === "jira"
        ? readWorkspaceBinding(claudeMdPath, mode)
        : { shared: false };
    const running = runningDptVersion();
    const floor = checkVersionFloor(binding, running).ok ? "ok" : "refused";
    process.stdout.write(`${JSON.stringify(binding)}\nrunning=${running} floor=${floor}\n`);
  } catch (e) {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }
}

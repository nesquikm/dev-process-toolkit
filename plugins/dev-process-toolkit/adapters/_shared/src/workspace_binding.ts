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

export interface WorkspaceBinding {
  team?: string;
  project?: string;
  defaultLabels?: string[];
}

export type WorkspaceAdapterKey = "linear" | "jira";

const SECTION_HEADING = "## Task Tracking";

function locateSubsection(lines: string[], adapterKey: WorkspaceAdapterKey): string[] | null {
  const sectionStart = lines.findIndex((l) => l === SECTION_HEADING);
  if (sectionStart < 0) return null;
  let sectionEnd = lines.length;
  for (let i = sectionStart + 1; i < lines.length; i++) {
    // Matches `# H1` or `## H2` to align with the codebase convention
    // (task_tracking_canonical_keys.ts, migrate-task-tracking-*.ts). H1 in
    // CLAUDE.md only appears at the file head, so this is equivalent to
    // `/^##\s/` in practice but keeps the parser shape consistent.
    if (/^#{1,2}\s/.test(lines[i]!)) {
      sectionEnd = i;
      break;
    }
  }
  const subTitle = adapterKey === "linear" ? "### Linear" : "### Jira";
  let subStart = -1;
  for (let i = sectionStart + 1; i < sectionEnd; i++) {
    if (lines[i] === subTitle) {
      subStart = i;
      break;
    }
  }
  if (subStart < 0) return null;
  let subEnd = sectionEnd;
  for (let i = subStart + 1; i < sectionEnd; i++) {
    if (/^#{2,3}\s/.test(lines[i]!)) {
      subEnd = i;
      break;
    }
  }
  return lines.slice(subStart + 1, subEnd);
}

function parseInlineYamlArray(raw: string): string[] {
  const trimmed = raw.trim();
  if (trimmed === "[]") return [];
  const inner = trimmed.replace(/^\[/, "").replace(/\]$/, "");
  if (inner.trim().length === 0) return [];
  return inner
    .split(",")
    .map((s) => s.trim())
    .map((s) => s.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1"))
    .filter((s) => s.length > 0);
}

export function readWorkspaceBinding(
  claudeMdPath: string,
  adapterKey: WorkspaceAdapterKey,
): WorkspaceBinding {
  if (!existsSync(claudeMdPath)) return {};
  const content = readFileSync(claudeMdPath, "utf-8");
  const lines = content.split("\n");
  const sub = locateSubsection(lines, adapterKey);
  if (!sub) return {};

  const result: WorkspaceBinding = {};
  for (const raw of sub) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    const m = /^([a-z_][a-z0-9_]*)\s*:\s*(.*)$/.exec(raw);
    if (!m) continue;
    const key = m[1]!;
    const value = m[2]!.trim();
    if (key === "default_labels") {
      result.defaultLabels = parseInlineYamlArray(value);
      continue;
    }
    if (value.length === 0) continue;
    if (key === "team") result.team = value;
    else if (key === "project") result.project = value;
  }
  return result;
}

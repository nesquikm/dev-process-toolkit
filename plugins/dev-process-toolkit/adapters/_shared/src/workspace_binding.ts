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
import { basename, join } from "node:path";
import { assertRepoTagForwarded } from "./create_idempotency_probe";
import {
  checkVersionFloor,
  FIRST_GATED_DPT_VERSION,
  nfr10Message,
  runningDptVersion,
  STRICT_SEMVER_RE,
} from "./dpt_version";
import { compareSemver } from "./migrations/coverage";
import { readTaskTrackingSection } from "./resolver_config";

export interface WorkspaceBinding {
  team?: string;
  project?: string;
  defaultLabels?: string[];
  /** STE-602 — this repository's ownership label in a shared container. */
  repoTag?: string;
  /** STE-602 — the lowest toolkit version allowed to write into the shared container. */
  minDptVersion?: string;
  /** STE-602 — always present; `true` exactly when a non-empty `repo_tag` is declared. */
  shared: boolean;
}

export type WorkspaceAdapterKey = "linear" | "jira";

/**
 * STE-602 — a malformed shared-container declaration (or an unreadable
 * CLAUDE.md). NFR-10 three-line message: verdict, `Remedy:`, `Context:`.
 * Tag membership (class 2) is refused by `RepoTagBindingError` instead.
 */
export class WorkspaceBindingError extends Error {
  constructor(verdict: string, remedy: string, context: string) {
    super(nfr10Message(verdict, remedy, context));
    this.name = "WorkspaceBindingError";
  }
}

const REPO_TAG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

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
  const lines = content.split("\n");
  const sub = locateSubsection(lines, adapterKey);
  if (!sub) return { shared: false };

  const result: Omit<WorkspaceBinding, "shared"> = {};
  const occurrences: Record<string, string[]> = { repo_tag: [], min_dpt_version: [] };
  for (const raw of sub) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    const m = /^([a-z_][a-z0-9_]*)\s*:\s*(.*)$/.exec(raw);
    if (!m) continue;
    const key = m[1]!;
    const value = m[2]!.trim();
    if (key in occurrences) occurrences[key]!.push(value);
    if (key === "default_labels") {
      result.defaultLabels = parseInlineYamlArray(value);
      continue;
    }
    if (value.length === 0) continue;
    if (key === "team") result.team = value;
    else if (key === "project") result.project = value;
    else if (key === "repo_tag") result.repoTag = value;
    else if (key === "min_dpt_version") result.minDptVersion = value;
  }
  validateDeclaration(result, occurrences, context);
  return { ...result, shared: result.repoTag !== undefined };
}

function refuse(verdict: string, remedy: string, context: string): never {
  throw new WorkspaceBindingError(`WorkspaceBindingError: ${verdict}`, remedy, context);
}

/**
 * STE-602 — the one validation pass over `repo_tag` / `min_dpt_version`.
 * Vacuous for an undeclared sub-section, so that path is unchanged.
 */
function validateDeclaration(
  result: Omit<WorkspaceBinding, "shared">,
  occurrences: Record<string, string[]>,
  context: string,
): void {
  // Class 5 — a key written twice is refused, never last-wins.
  for (const [key, values] of Object.entries(occurrences)) {
    if (values.length > 1) {
      refuse(
        `\`${key}\` is written ${values.length} times (values: ${values.map((v) => `"${v}"`).join(", ")}) — a duplicated declaration key is ambiguous and is never resolved last-wins.`,
        `keep exactly one \`${key}:\` line in the tracker sub-section.`,
        `${context}, key=${key}, value="${values[values.length - 1]}"`,
      );
    }
  }
  const tag = result.repoTag;
  const floor = result.minDptVersion;
  // Class 1 — tag shape.
  if (tag !== undefined && !REPO_TAG_RE.test(tag)) {
    refuse(
      `repo_tag "${tag}" is not lowercase-kebab (^[a-z0-9]+(-[a-z0-9]+)*$).`,
      `rename the tag to lowercase letters, digits and single hyphens (e.g. "glacy-be"), in both \`repo_tag\` and \`default_labels\`.`,
      `${context}, key=repo_tag, value="${tag}"`,
    );
  }
  // Class 3 — strict X.Y.Z floor.
  if (floor !== undefined && !STRICT_SEMVER_RE.test(floor)) {
    refuse(
      `min_dpt_version "${floor}" is not strict X.Y.Z (no \`v\` prefix, no pre-release suffix).`,
      `write the floor as a bare release version, e.g. "${FIRST_GATED_DPT_VERSION}".`,
      `${context}, key=min_dpt_version, value="${floor}"`,
    );
  }
  // Class 4 — the two keys come as a pair.
  if (tag !== undefined && floor === undefined) {
    refuse(
      `repo_tag "${tag}" is declared with no min_dpt_version — a shared container needs a toolkit version floor.`,
      `add \`min_dpt_version: ${FIRST_GATED_DPT_VERSION}\` (or later) beside \`repo_tag\`, or remove \`repo_tag\`.`,
      `${context}, key=repo_tag, value="${tag}"`,
    );
  }
  if (floor !== undefined && tag === undefined) {
    refuse(
      `min_dpt_version "${floor}" is declared with no repo_tag — a floor without an ownership label declares nothing.`,
      `add \`repo_tag: <lowercase-kebab>\` beside the floor, or remove \`min_dpt_version\`.`,
      `${context}, key=min_dpt_version, value="${floor}"`,
    );
  }
  // Class 2 — tag membership, through its one definition.
  assertRepoTagForwarded(tag, result.defaultLabels);
  // Class 6 — a floor below the first gated release admits ungated clients.
  if (floor !== undefined && (compareSemver(floor, FIRST_GATED_DPT_VERSION) ?? 0) < 0) {
    refuse(
      `min_dpt_version "${floor}" is below FIRST_GATED_DPT_VERSION ${FIRST_GATED_DPT_VERSION} — such a floor admits clients that carry no shared-container write gate.`,
      `raise \`min_dpt_version\` to ${FIRST_GATED_DPT_VERSION} or later.`,
      `${context}, key=min_dpt_version, value="${floor}"`,
    );
  }
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

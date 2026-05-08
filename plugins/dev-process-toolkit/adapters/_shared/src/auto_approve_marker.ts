// auto_approve_marker (STE-226 AC-STE-226.5) — /gate-check probe
// `auto_approve_marker_in_canonical_spawns`. Severity: error.
//
// Globs `plugins/dev-process-toolkit/skills/*/SKILL.md` and
// `.claude/skills/*/SKILL.md`, finds every fenced ```bash block whose
// body contains a `claude -p ` invocation paired with a heredoc-on-stdin
// (`<<'TAG'`, `<<TAG`, `<<${VAR}`), and asserts the canonical marker
// line `<dpt:auto-approve>v1</dpt:auto-approve>` appears on its own line
// inside that fence. Hard fail when missing.
//
// Non-prompt-bearing `< /dev/null` snippets are intentionally out of
// scope: they target skills (`/gate-check`, `/spec-review`, `/simplify`)
// that have no operator-approval gate, so a marker would be redundant.
// The probe scopes to heredoc fences via the `<<TAG` regex anchor.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { extractBashFences } from "./markdown_fences";

export type Severity = "error" | "warning";

export interface AutoApproveMarkerViolation {
  file: string;
  line: number;
  reason: string;
  note: string;
  message: string;
  severity: Severity;
}

export interface AutoApproveMarkerReport {
  violations: AutoApproveMarkerViolation[];
}

const MARKER = "<dpt:auto-approve>v1</dpt:auto-approve>";

// Heredoc-on-stdin shapes: `<<'TAG'`, `<<"TAG"`, `<<TAG`, `<<${VAR}`.
// Single quotes are the canonical form (prevents shell expansion in body)
// but the probe accepts all four shapes so the negative case fires for
// any heredoc-bearing spawn.
const HEREDOC_RE = /<<\s*(?:['"]?[A-Za-z_][\w]*['"]?|\$\{[A-Za-z_][\w]*\})/;

function buildMessage(file: string, line: number): string {
  return [
    `auto_approve_marker_in_canonical_spawns: ${file}:${line} — ` +
      `prompt-bearing \`claude -p\` spawn fence is missing the canonical ` +
      `auto-approve marker line \`${MARKER}\` on its own line in the ` +
      `heredoc body.`,
    `Remedy: insert the marker as the first body line of the heredoc ` +
      `(immediately after \`<<'PROMPT_EOF'\` or equivalent). The marker is ` +
      `the byte-checkable pre-authorization token children gate on under ` +
      `\`claude -p\` (STE-226); without it, draft + commit gates in ` +
      `\`/spec-write\` and the Phase 4 step 15 gate in \`/implement\` ` +
      `fire interactively and the child halts at the prompt.`,
    `Context: file=${file}, probe=auto_approve_marker_in_canonical_spawns, severity=error`,
  ].join("\n");
}

/**
 * A fence is a "prompt-bearing canonical spawn" when its body contains
 * `claude -p ` AND a heredoc-on-stdin shape (`<<TAG` family).
 */
function isPromptBearingSpawn(body: string): boolean {
  return /\bclaude\s+-p\b/.test(body) && HEREDOC_RE.test(body);
}

/**
 * Assert that the marker line appears on its own line inside the fence
 * body. The detection contract is "literal line `<dpt:auto-approve>v1</dpt:auto-approve>`
 * on its own line" — mid-line matches do not satisfy.
 */
function fenceCarriesMarker(body: string): boolean {
  return body
    .split("\n")
    .some((line) => line.trim() === MARKER);
}

function scanSkillFile(
  absPath: string,
  projectRoot: string,
): AutoApproveMarkerViolation[] {
  if (!existsSync(absPath)) return [];
  let content: string;
  try {
    content = readFileSync(absPath, "utf-8");
  } catch {
    return [];
  }
  const rel = relative(projectRoot, absPath);
  const violations: AutoApproveMarkerViolation[] = [];
  for (const fence of extractBashFences(content)) {
    if (!isPromptBearingSpawn(fence.body)) continue;
    if (fenceCarriesMarker(fence.body)) continue;
    const reason =
      `prompt-bearing \`claude -p\` spawn fence missing auto-approve marker ` +
      `line "${MARKER}"`;
    violations.push({
      file: absPath,
      line: fence.startLine,
      reason,
      note: `${rel}:${fence.startLine} — ${reason}`,
      message: buildMessage(rel, fence.startLine),
      severity: "error",
    });
  }
  return violations;
}

function listSkillFiles(skillsDir: string): string[] {
  if (!existsSync(skillsDir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(skillsDir);
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const name of entries) {
    const dir = join(skillsDir, name);
    let s;
    try {
      s = statSync(dir);
    } catch {
      continue;
    }
    if (!s.isDirectory()) continue;
    const skillMd = join(dir, "SKILL.md");
    if (existsSync(skillMd)) files.push(skillMd);
  }
  return files;
}

export async function runAutoApproveMarkerProbe(
  projectRoot: string,
): Promise<AutoApproveMarkerReport> {
  const pluginSkillsDir = join(
    projectRoot,
    "plugins",
    "dev-process-toolkit",
    "skills",
  );
  const projectSkillsDir = join(projectRoot, ".claude", "skills");
  const violations: AutoApproveMarkerViolation[] = [];
  for (const f of listSkillFiles(pluginSkillsDir)) {
    violations.push(...scanSkillFile(f, projectRoot));
  }
  for (const f of listSkillFiles(projectSkillsDir)) {
    violations.push(...scanSkillFile(f, projectRoot));
  }
  return { violations };
}

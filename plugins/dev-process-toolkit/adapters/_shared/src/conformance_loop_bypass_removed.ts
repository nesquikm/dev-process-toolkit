// conformance_loop_bypass_removed (STE-252 AC-STE-252.4) — /gate-check
// probe `conformance-loop-bypass-removed`. Severity: error.
//
// Globs `.claude/skills/{conformance-loop,smoke-test}/SKILL.md`, finds
// every fenced ```bash block whose body contains a `claude -p `
// invocation, and asserts none carry `--permission-mode bypassPermissions`.
//
// The new posture (STE-252) is content-rich `permissions.allow` in the
// tracked `.claude/settings.json` — children spawn in default permission
// mode and honor the tracked allowlist. `bypassPermissions` is removed
// at every spawn site reachable from `/conformance-loop`. This probe
// locks the regression surface so a future edit cannot silently restore
// the bypass.
//
// Vacuous on toolkit-consumer repos that ship neither file. The probe
// scope is *every* `claude -p` fence (including non-prompt-bearing
// `< /dev/null` fences); unlike STE-226's marker probe, the
// bypass-removal rule is universal across the call tree.

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { extractBashFences } from "./markdown_fences";

export type Severity = "error" | "warning";

export interface ConformanceLoopBypassRemovedViolation {
  file: string;
  line: number;
  reason: string;
  note: string;
  message: string;
  severity: Severity;
}

export interface ConformanceLoopBypassRemovedReport {
  violations: ConformanceLoopBypassRemovedViolation[];
}

const PROBE_NAME = "conformance-loop-bypass-removed";
const BYPASS_TOKEN = "--permission-mode bypassPermissions";

function buildMessage(file: string, line: number): string {
  return [
    `${PROBE_NAME}: ${file}:${line} — ` +
      `\`claude -p\` spawn fence carries \`${BYPASS_TOKEN}\`. ` +
      `STE-252 replaced the blanket bypass with a tracked ` +
      `\`permissions.allow\` block in \`.claude/settings.json\`; ` +
      `every spawn site reachable from \`/conformance-loop\` must drop ` +
      `the flag and run in default permission mode.`,
    `Remedy: remove the \`${BYPASS_TOKEN}\` line (and its trailing ` +
      `backslash) from this fenced \`bash\` block. Children inherit ` +
      `the tracked allowlist from \`.claude/settings.json\` at the spawn ` +
      `cwd; if a real tool surface is missing, extend the allowlist ` +
      `rather than restoring the bypass.`,
    `Context: file=${file}, probe=${PROBE_NAME}, severity=error`,
  ].join("\n");
}

/**
 * A fence is in scope when its body contains a `claude -p ` invocation.
 * The bypass-removal rule is universal across both prompt-bearing
 * (heredoc) and non-prompt-bearing (`< /dev/null`) spawns.
 */
function isClaudeSpawnFence(body: string): boolean {
  return /\bclaude\s+-p\b/.test(body);
}

/**
 * Locate the in-fence line offset (0-based) of the `bypassPermissions`
 * marker. Returns -1 if absent.
 */
function findBypassOffset(body: string): number {
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.includes(BYPASS_TOKEN)) return i;
  }
  return -1;
}

function scanSkillFile(
  absPath: string,
  projectRoot: string,
): ConformanceLoopBypassRemovedViolation[] {
  if (!existsSync(absPath)) return [];
  let content: string;
  try {
    content = readFileSync(absPath, "utf-8");
  } catch {
    return [];
  }
  const rel = relative(projectRoot, absPath);
  const violations: ConformanceLoopBypassRemovedViolation[] = [];
  for (const fence of extractBashFences(content)) {
    if (!isClaudeSpawnFence(fence.body)) continue;
    const offset = findBypassOffset(fence.body);
    if (offset === -1) continue;
    const line = fence.bodyStartLine + offset;
    const reason =
      `\`claude -p\` spawn fence carries \`${BYPASS_TOKEN}\` ` +
      `(STE-252 dropped the blanket bypass in favor of tracked ` +
      `\`permissions.allow\`)`;
    violations.push({
      file: absPath,
      line,
      reason,
      note: `${rel}:${line} — ${reason}`,
      message: buildMessage(rel, line),
      severity: "error",
    });
  }
  return violations;
}

export async function runConformanceLoopBypassRemovedProbe(
  projectRoot: string,
): Promise<ConformanceLoopBypassRemovedReport> {
  const targets = [
    join(projectRoot, ".claude", "skills", "conformance-loop", "SKILL.md"),
    join(projectRoot, ".claude", "skills", "smoke-test", "SKILL.md"),
  ];
  const violations: ConformanceLoopBypassRemovedViolation[] = [];
  for (const f of targets) {
    violations.push(...scanSkillFile(f, projectRoot));
  }
  return { violations };
}

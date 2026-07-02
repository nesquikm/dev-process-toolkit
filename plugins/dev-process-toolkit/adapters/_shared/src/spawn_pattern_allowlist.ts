// spawn_pattern_allowlist — /gate-check probe `spawn_pattern_allowlist`.
// Severity: error.
//
// Fails GATE when the child-spawn pattern `Bash(claude:*)` is absent
// from EITHER of two surfaces:
//   (a) the tracked `.claude/settings.json` `permissions.allow` array
//       at the project root, or
//   (b) the /smoke-test scaffold snippet — the settings-writing
//       `cat > .claude/settings.json <<'EOF'` heredoc inside
//       `.claude/skills/smoke-test/SKILL.md` that pre-creates the child
//       test-project's settings.
//
// This is the fence the M94 false-green proved was missing: a non-empty
// allow-list (`length > 0`) still shipped the regression because the
// load-bearing spawn pattern was missing — nested `claude -p` spawns
// were classifier-denied headless and grandchildren died as 0-byte
// transcripts. Probe shape mirrors `conformance_loop_bypass_removed.ts`.
//
// Vacuous when a surface's file is absent (toolkit-consumer repos ship
// neither). Fail-closed when a surface exists but the pattern's
// presence cannot be verified (malformed settings JSON; SKILL.md
// without a settings-writing heredoc). The scaffold check is scoped to
// the heredoc body itself — prose mentions of the pattern elsewhere in
// the SKILL.md do not satisfy it. The real scaffold fence is indented
// inside a numbered list item, so the scan is line-based rather than
// reusing the column-0-only `extractBashFences` helper.

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

export type Severity = "error" | "warning";

export interface SpawnPatternAllowlistViolation {
  file: string;
  line: number;
  note: string;
  message: string;
  severity: Severity;
}

export interface SpawnPatternAllowlistReport {
  violations: SpawnPatternAllowlistViolation[];
}

const PROBE_NAME = "spawn_pattern_allowlist";

/** Canonical child-spawn allow-list literal. */
export const SPAWN_PATTERN = "Bash(claude:*)";

/** Opener line of the settings-writing scaffold heredoc. */
const HEREDOC_OPENER_RE = /\bcat\s*>\s*\.claude\/settings\.json\s*<<\s*'?EOF'?/;

function buildMessage(rel: string, line: number, reason: string): string {
  return [
    `${PROBE_NAME}: ${rel}:${line} — ${reason}`,
    `Remedy: add "${SPAWN_PATTERN}" to the permissions.allow allow-list ` +
      `in the tracked .claude/settings.json AND keep the /smoke-test ` +
      `scaffold snippet (the settings-writing heredoc in ` +
      `.claude/skills/smoke-test/SKILL.md) in sync, then re-run /gate-check.`,
    `Context: file=${rel}, probe=${PROBE_NAME}, severity=error; without ` +
      `the child-spawn pattern every nested \`claude -p\` spawn is ` +
      `classifier-denied headless and the grandchildren die as 0-byte ` +
      `transcripts (the M94 false-green).`,
  ].join("\n");
}

function makeViolation(
  absPath: string,
  projectRoot: string,
  line: number,
  reason: string,
): SpawnPatternAllowlistViolation {
  const rel = relative(projectRoot, absPath);
  return {
    file: absPath,
    line,
    note: `${rel}:${line} — ${reason}`,
    message: buildMessage(rel, line, reason),
    severity: "error",
  };
}

/** Surface (a): the tracked project-root `.claude/settings.json`. */
function scanSettings(
  absPath: string,
  projectRoot: string,
): SpawnPatternAllowlistViolation[] {
  if (!existsSync(absPath)) return [];
  let raw: string;
  try {
    raw = readFileSync(absPath, "utf-8");
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [
      makeViolation(
        absPath,
        projectRoot,
        1,
        `settings JSON is malformed — presence of the child-spawn ` +
          `pattern "${SPAWN_PATTERN}" in permissions.allow cannot be ` +
          `verified (fail-closed)`,
      ),
    ];
  }
  const permissions =
    typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)["permissions"]
      : undefined;
  const allow =
    typeof permissions === "object" && permissions !== null
      ? (permissions as Record<string, unknown>)["allow"]
      : undefined;
  if (Array.isArray(allow) && allow.includes(SPAWN_PATTERN)) return [];
  // Cite the `"allow"` line (not line 1) for an actionable diff anchor.
  const lines = raw.split("\n");
  let line = 1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]!.includes('"allow"')) {
      line = i + 1;
      break;
    }
  }
  return [
    makeViolation(
      absPath,
      projectRoot,
      line,
      `permissions.allow lacks the child-spawn pattern "${SPAWN_PATTERN}"`,
    ),
  ];
}

/**
 * Surface (b): the settings-writing heredoc(s) inside the /smoke-test
 * SKILL.md. The pattern must appear INSIDE a heredoc body (opener line
 * through the `EOF` terminator); prose mentions elsewhere do not count.
 */
function scanSmokeTestScaffold(
  absPath: string,
  projectRoot: string,
): SpawnPatternAllowlistViolation[] {
  if (!existsSync(absPath)) return [];
  let content: string;
  try {
    content = readFileSync(absPath, "utf-8");
  } catch {
    return [];
  }
  const lines = content.split("\n");
  const violations: SpawnPatternAllowlistViolation[] = [];
  let sawHeredoc = false;
  for (let i = 0; i < lines.length; i++) {
    if (!HEREDOC_OPENER_RE.test(lines[i]!)) continue;
    sawHeredoc = true;
    const openerLine = i + 1; // 1-based
    let hasPattern = false;
    let j = i + 1;
    for (; j < lines.length; j++) {
      if (lines[j]!.trim() === "EOF") break;
      if (lines[j]!.includes(SPAWN_PATTERN)) hasPattern = true;
    }
    if (!hasPattern) {
      violations.push(
        makeViolation(
          absPath,
          projectRoot,
          openerLine,
          `settings-writing scaffold heredoc lacks the child-spawn ` +
            `pattern "${SPAWN_PATTERN}" in its allow-list`,
        ),
      );
    }
    i = j;
  }
  if (!sawHeredoc) {
    violations.push(
      makeViolation(
        absPath,
        projectRoot,
        1,
        `no settings-writing scaffold heredoc ` +
          `(\`cat > .claude/settings.json <<'EOF'\`) found — presence of ` +
          `the child-spawn pattern "${SPAWN_PATTERN}" cannot be verified ` +
          `(fail-closed)`,
      ),
    );
  }
  return violations;
}

export async function runSpawnPatternAllowlistProbe(
  projectRoot: string,
): Promise<SpawnPatternAllowlistReport> {
  const violations: SpawnPatternAllowlistViolation[] = [
    ...scanSettings(join(projectRoot, ".claude", "settings.json"), projectRoot),
    ...scanSmokeTestScaffold(
      join(projectRoot, ".claude", "skills", "smoke-test", "SKILL.md"),
      projectRoot,
    ),
  ];
  return { violations };
}

// setup_permissions_shape — STE-209 AC-STE-209.6 (analogous ADVISORY
// probe for user-project `.claude/settings.json`).
//
// Walks the user-project `.claude/settings.json` and flags glob-shaped
// Bash rules — `Bash(<cmd> *)` patterns. The harness denies any glob-
// shaped Bash rule when /setup writes the file on a fresh repo (F3b);
// the corresponding ADVISORY probe surfaces drift in already-existing
// settings.json files without rewriting them (operator-driven
// migration, AC-STE-209.6).
//
// Severity: advisory only. `/setup --migrate` is the canonical
// migration path; this probe is the read-side signal that the
// migration is needed.

import { readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

export interface SetupPermissionsShapeViolation {
  file: string;
  line: number;
  rule: string;
  reason: string;
  note: string;
}

export interface SetupPermissionsShapeReport {
  violations: SetupPermissionsShapeViolation[];
}

/** Glob-shaped Bash rule: `Bash(<cmd> *)` (asterisk after a space). */
const GLOB_RULE_RE = /"Bash\(([^)]*\s\*)\)"/g;

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function runSetupPermissionsShapeProbe(
  projectRoot: string,
): Promise<SetupPermissionsShapeReport> {
  const file = join(projectRoot, ".claude", "settings.json");
  if (!(await fileExists(file))) {
    return { violations: [] };
  }
  let content: string;
  try {
    content = await readFile(file, "utf-8");
  } catch {
    return { violations: [] };
  }

  const violations: SetupPermissionsShapeViolation[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    GLOB_RULE_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = GLOB_RULE_RE.exec(line)) !== null) {
      const rule = match[1]!;
      const rel = relative(projectRoot, file);
      const reason = `glob-shaped Bash rule \`Bash(${rule})\` triggers harness self-modification denial when /setup writes settings.json; switch to explicit-subcommand allowlist`;
      violations.push({
        file,
        line: i + 1,
        rule,
        reason,
        note: `${rel}:${i + 1} — ${reason}`,
      });
    }
  }
  return { violations };
}

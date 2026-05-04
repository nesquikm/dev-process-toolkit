// mcp_config_shape — STE-209 AC-STE-209.4 + STE-209 AC-STE-209.6.
//
// Validates `.mcp.json` entries against Claude Code's MCP server
// configuration schema. The canonical shape is `{ "type": "http", "url":
// "..." }` for HTTP-transport servers; the F6 bug shape was
// `{ "transport": "streamable-http", "url": "..." }` — `/doctor` rejects
// the `transport` field as not adhering to the schema.
//
// Probe also accepts stdio shapes (`{ "command": "...", "args": [...] }`)
// without flagging — those are a separate schema branch and out of scope
// for this probe.
//
// Severity routing:
//   - User-project `.mcp.json` (the project root being checked) ⇒ ADVISORY
//     (don't break existing repos with the legacy shape).
//   - Toolkit-shipped templates / docs that emit the canonical example
//     (the toolkit self-run) ⇒ ERROR (we ship the schema, we should ship
//     it correctly).
//
// The probe runs both passes; severity is reported per-violation.

import { readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

export type McpConfigSeverity = "advisory" | "error";

export interface McpConfigViolation {
  file: string;
  line: number;
  reason: string;
  note: string;
  severity: McpConfigSeverity;
}

export interface McpConfigShapeReport {
  violations: McpConfigViolation[];
}

/** Files that should ship the canonical shape (severity: error). */
const TOOLKIT_OWNED_RELATIVE = [
  "plugins/dev-process-toolkit/docs/setup-tracker-mode.md",
  "plugins/dev-process-toolkit/templates/CLAUDE.md.template",
  "plugins/dev-process-toolkit/skills/setup/SKILL.md",
];

/** The bug shape we're flagging. Canonical replacement is `"type": "http"`.
 *  Constructed per-call inside `scanFile` to avoid module-level mutable
 *  `lastIndex` across concurrent async invocations. */
const TRANSPORT_FIELD_PATTERN = '"transport"\\s*:\\s*"streamable-http"';

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function scanFile(
  file: string,
  projectRoot: string,
  severity: McpConfigSeverity,
): Promise<McpConfigViolation[]> {
  let content: string;
  try {
    content = await readFile(file, "utf-8");
  } catch {
    return [];
  }
  // Per-call regex (no module-level state) — avoids the shared-lastIndex
  // re-entrancy hazard if the probe is ever invoked concurrently.
  const re = new RegExp(TRANSPORT_FIELD_PATTERN);
  const out: McpConfigViolation[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!re.test(lines[i]!)) continue;
    const reason = `\`"transport": "streamable-http"\` is not a Claude Code MCP schema field; canonical shape uses \`"type": "http"\``;
    const rel = relative(projectRoot, file);
    out.push({
      file,
      line: i + 1,
      reason,
      note: `${rel}:${i + 1} — ${reason}`,
      severity,
    });
  }
  return out;
}

export async function runMcpConfigShapeProbe(
  projectRoot: string,
): Promise<McpConfigShapeReport> {
  const violations: McpConfigViolation[] = [];

  // Pass 1 — toolkit-shipped templates / docs (severity: error).
  for (const rel of TOOLKIT_OWNED_RELATIVE) {
    const path = join(projectRoot, rel);
    if (!(await fileExists(path))) continue;
    violations.push(...(await scanFile(path, projectRoot, "error")));
  }

  // Pass 2 — user-project `.mcp.json` (severity: advisory).
  const mcpJson = join(projectRoot, ".mcp.json");
  if (await fileExists(mcpJson)) {
    violations.push(...(await scanFile(mcpJson, projectRoot, "advisory")));
  }

  return { violations };
}

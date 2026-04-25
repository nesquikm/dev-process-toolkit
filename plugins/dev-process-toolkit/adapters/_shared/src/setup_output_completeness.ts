// setup_output_completeness — /gate-check probe (STE-106 AC-STE-106.5).
//
// If CLAUDE.md `## Task Tracking` declares `mode: <tracker>` (≠ none), the
// project root MUST contain `.mcp.json` with the corresponding `mcpServers`
// entry. Skipped when mode = none or CLAUDE.md is absent.
//
// Catches the smoke-test failure mode (F1, F2 in /tmp/dpt-smoke-findings.md):
// /setup self-aborted on `.mcp.json` writes and silently moved on, leaving
// the project advertising a tracker mode it can't talk to.

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { readTaskTrackingSection } from "./resolver_config";

export interface SetupOutputCompletenessViolation {
  file: string;
  line: number;
  reason: string;
  note: string;
  message: string;
}

export interface SetupOutputCompletenessReport {
  mode: string;
  violations: SetupOutputCompletenessViolation[];
}

function buildMessage(reason: string, mode: string, file: string): string {
  return [
    `setup_output_completeness: ${reason}`,
    `Remedy: re-run /setup or write ${file} with an "mcpServers.<adapter>" entry that matches the active tracker mode (see plugins/dev-process-toolkit/skills/setup/SKILL.md step 7b).`,
    `Context: mode=${mode}, file=${file}, probe=setup_output_completeness`,
  ].join("\n");
}

export async function runSetupOutputCompletenessProbe(
  projectRoot: string,
): Promise<SetupOutputCompletenessReport> {
  const claudeMd = join(projectRoot, "CLAUDE.md");
  if (!existsSync(claudeMd)) return { mode: "none", violations: [] };

  const section = readTaskTrackingSection(claudeMd);
  const mode = (section["mode"] ?? "none").trim();
  if (!mode || mode === "none") return { mode: "none", violations: [] };

  const mcpJsonPath = join(projectRoot, ".mcp.json");
  const mcpJsonRel = relative(projectRoot, mcpJsonPath);

  if (!existsSync(mcpJsonPath)) {
    const reason = `${mcpJsonRel} missing — tracker mode "${mode}" requires the file with an mcpServers entry`;
    return {
      mode,
      violations: [
        {
          file: mcpJsonPath,
          line: 1,
          reason,
          note: `${mcpJsonRel}:1 — ${reason}`,
          message: buildMessage(reason, mode, mcpJsonRel),
        },
      ],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(mcpJsonPath, "utf-8"));
  } catch (err) {
    const reason = `${mcpJsonRel} malformed JSON: ${(err as Error).message} — parse error blocks the probe`;
    return {
      mode,
      violations: [
        {
          file: mcpJsonPath,
          line: 1,
          reason,
          note: `${mcpJsonRel}:1 — ${reason}`,
          message: buildMessage(reason, mode, mcpJsonRel),
        },
      ],
    };
  }

  const mcpServerKey = (section["mcp_server"] ?? mode).trim() || mode;
  const servers = (parsed as { mcpServers?: Record<string, unknown> }).mcpServers ?? {};
  if (!Object.prototype.hasOwnProperty.call(servers, mcpServerKey)) {
    const reason = `${mcpJsonRel} mcpServers.${mcpServerKey} missing — tracker mode declares "${mode}" but ${mcpJsonRel} has no matching server entry`;
    return {
      mode,
      violations: [
        {
          file: mcpJsonPath,
          line: 1,
          reason,
          note: `${mcpJsonRel}:1 — ${reason}`,
          message: buildMessage(reason, mode, mcpJsonRel),
        },
      ],
    };
  }

  return { mode, violations: [] };
}

// STE-719 (M_d1b4b7) — the /retro front door.
//
//   bun run adapters/_shared/src/retro.ts <projectRoot> [scope]
//
// Loads the tracking switches, resolves the scope (retro_scope.ts), reads the
// three parent-visible sources through `readLedgerRows` and the M_7bc805 path
// composers, runs the rule engine, aliases sessions through the report
// builder and writes exactly one file:
// `.dpt/ledger/retro/<scope-slug>-<UTC yyyymmddThhmmssZ>.json`.
//
// A hand run always runs: this module never reads `retro.enabled`.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { retroReportsDir, toolCallLedgerPath, toolCallTimelinePath } from "./dpt_paths";
import { runningDptVersion } from "./dpt_version";
import { loadProjectSection } from "./project_settings";
import { buildRetroReport, type RetroReport } from "./retro_report";
import { SKIPPED_DISPOSITION, evaluateRetroRules, type RetroInputs, type RetroRuleResult } from "./retro_rules";
import { resolveRetroScope, type RetroScope } from "./retro_scope";
import { readLedgerRows } from "./token_usage";

function trackingSwitches(projectRoot: string): RetroInputs["tracking"] {
  let tr: Record<string, { enabled?: boolean } | undefined> = {};
  try {
    tr = (loadProjectSection(projectRoot, "tracking") ?? {}) as typeof tr;
  } catch {
    // an unreadable settings file leaves every switch off
  }
  return {
    token_stats: tr.token_stats?.enabled === true,
    tool_calls: tr.tool_calls?.enabled === true,
    gate_outcomes: tr.gate_outcomes?.enabled === true,
  };
}

function readJson(path: string): unknown | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    return null;
  }
}

function readJsonl(path: string): unknown[] {
  if (!existsSync(path)) return [];
  let body: string;
  try {
    body = readFileSync(path, "utf-8");
  } catch {
    return [];
  }
  const rows: unknown[] = [];
  for (const line of body.split("\n")) {
    if (line.trim() === "") continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      // a malformed line is skipped
    }
  }
  return rows;
}

export function gatherRetroInputs(projectRoot: string, scope: RetroScope): RetroInputs {
  const ids = new Set(scope.sessions);
  return {
    sessions: scope.sessions.map((s) => ({
      session_id: s,
      timeline: readJson(toolCallTimelinePath(projectRoot, s)),
      capture_rows: readJsonl(toolCallLedgerPath(projectRoot, s)),
    })),
    token_rows: readLedgerRows(projectRoot).filter((r) => typeof r.session_id === "string" && ids.has(r.session_id)),
    tracking: trackingSwitches(projectRoot),
  };
}

/** UTC `yyyymmddThhmmssZ`. */
export function retroStamp(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[-:]/g, "");
}

export function scopeSlug(scope: RetroScope): string {
  if (scope.kind === "session" || scope.id === null) return "session";
  const slug = scope.id.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[^a-z0-9]+/, "");
  return slug === "" ? scope.kind : slug;
}

export function runRetro(projectRoot: string, arg: string | undefined, now: Date = new Date()): { path: string; report: RetroReport } {
  const scope = resolveRetroScope(projectRoot, arg);
  let results: RetroRuleResult[] = evaluateRetroRules(gatherRetroInputs(projectRoot, scope));
  if (scope.sessions.length === 0 && scope.reason !== null) {
    results = results.map((r) => ({ ...r, value: null, disposition: SKIPPED_DISPOSITION, reason: scope.reason }));
  }
  const report = buildRetroReport({
    scope: { kind: scope.kind, id: scope.id },
    sessionIds: scope.sessions,
    results,
    pluginVersion: runningDptVersion(),
    generatedAt: now.toISOString(),
  });
  const dir = retroReportsDir(projectRoot);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${scopeSlug(scope)}-${retroStamp(now)}.json`);
  writeFileSync(path, JSON.stringify(report, null, 2) + "\n");
  return { path, report };
}

if (import.meta.main) {
  const [rootArg, scopeArg] = process.argv.slice(2);
  if (rootArg === undefined || rootArg.trim() === "") {
    process.stderr.write("usage: bun run retro.ts <projectRoot> [scope]\n");
    process.exit(2);
  }
  try {
    const { path, report } = runRetro(resolve(rootArg), scopeArg);
    process.stdout.write(JSON.stringify({ report: path, tripped_count: report.tripped_count, suggested_severity: report.suggested_severity }) + "\n");
  } catch (e) {
    process.stderr.write(`${(e as Error).message}\n`);
    process.exit(1);
  }
}

// STE-719 (M_d1b4b7) — the /retro report, schema `dpt-retro/1`.
//
// `buildRetroReport` turns the engine's rule results into the report; every
// session id goes through `aliasFor` (session_aliases.ts), so the report holds
// only `s<N>` aliases with their digests — never a raw id, path, command, cwd
// or branch name. `parseRetroReport` is the schema validator.
//
// `suggested_severity` is `low` for one tripped rule, `medium` for two or
// more, `null` when nothing tripped, and never `high`.

import { RETRO_DISPOSITIONS, type RetroRuleResult } from "./retro_rules";
import { SESSION_ALIAS_RE, aliasFor, createAliasMap, sessionDigest, type AliasMap, type SessionAlias } from "./session_aliases";

export const RETRO_REPORT_SCHEMA = "dpt-retro/1" as const;
export const RETRO_SEVERITIES = ["low", "medium"] as const;
export type RetroSeverity = (typeof RETRO_SEVERITIES)[number];

export interface RetroReportScope {
  kind: string;
  id: string | null;
}

export interface RetroReport {
  schema: typeof RETRO_REPORT_SCHEMA;
  plugin_version: string;
  generated_at: string;
  scope: RetroReportScope;
  sessions: SessionAlias[];
  rules: RetroRuleResult[];
  tripped_count: number;
  suggested_severity: RetroSeverity | null;
}

export interface BuildRetroReportInput {
  scope: RetroReportScope;
  sessionIds: readonly string[];
  results: readonly RetroRuleResult[];
  pluginVersion: string;
  generatedAt: string;
  /** A map already seeded from earlier reports (seedAliasMap), so one session keeps one alias. */
  aliasMap?: AliasMap;
}

export function severityFor(trippedCount: number): RetroSeverity | null {
  if (trippedCount <= 0) return null;
  return trippedCount === 1 ? "low" : "medium";
}

export function buildRetroReport(input: BuildRetroReportInput): RetroReport {
  const map = input.aliasMap ?? createAliasMap();
  const sessions: SessionAlias[] = [];
  const seen = new Set<string>();
  for (const id of input.sessionIds) {
    const alias = aliasFor(map, id);
    if (seen.has(alias)) continue;
    seen.add(alias);
    sessions.push({ alias, digest: sessionDigest(id) });
  }
  const scope: RetroReportScope =
    input.scope.kind === "session" && input.scope.id !== null
      ? { kind: "session", id: aliasFor(map, input.scope.id) }
      : { kind: input.scope.kind, id: input.scope.id };
  const rules = input.results.map((r) => ({
    id: r.id,
    source: [...r.source],
    threshold: r.threshold,
    unit: r.unit,
    value: r.value,
    disposition: r.disposition,
    reason: r.reason,
  }));
  const tripped_count = rules.filter((r) => r.disposition === "tripped").length;
  return {
    schema: RETRO_REPORT_SCHEMA,
    plugin_version: input.pluginVersion,
    generated_at: input.generatedAt,
    scope,
    sessions,
    rules,
    tripped_count,
    suggested_severity: severityFor(tripped_count),
  };
}

const REPORT_KEYS = ["generated_at", "plugin_version", "rules", "schema", "scope", "sessions", "suggested_severity", "tripped_count"];
const RULE_KEYS = ["disposition", "id", "reason", "source", "threshold", "unit", "value"];
const DIGEST_RE = /^[0-9a-f]{16}$/;
const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/;

function fail(msg: string): never {
  throw new Error(`parseRetroReport: ${msg}`);
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function sameKeys(o: Record<string, unknown>, keys: string[]): boolean {
  const k = Object.keys(o).sort();
  return k.length === keys.length && k.every((x, i) => x === keys[i]);
}

/** Validate one `dpt-retro/1` report; throws on any deviation. */
export function parseRetroReport(text: string): RetroReport {
  if (UUID_RE.test(text)) fail("holds a UUID-shaped token");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    fail(`not JSON: ${(e as Error).message}`);
  }
  if (!isObject(raw)) fail("not an object");
  if (!sameKeys(raw, REPORT_KEYS)) fail(`keys must be ${REPORT_KEYS.join(", ")}`);
  if (raw.schema !== RETRO_REPORT_SCHEMA) fail(`schema must be ${RETRO_REPORT_SCHEMA}`);
  if (typeof raw.plugin_version !== "string") fail("plugin_version must be a string");
  if (typeof raw.generated_at !== "string") fail("generated_at must be a string");

  const scope = raw.scope;
  if (!isObject(scope) || !sameKeys(scope, ["id", "kind"]) || typeof scope.kind !== "string") fail("scope must be { kind, id }");
  if (scope.id !== null && typeof scope.id !== "string") fail("scope.id must be a string or null");
  if (scope.kind === "session" && scope.id !== null && !SESSION_ALIAS_RE.test(scope.id)) fail("a session scope's id must be an alias");

  if (!Array.isArray(raw.sessions)) fail("sessions must be an array");
  const aliases = new Set<string>();
  for (const s of raw.sessions) {
    if (!isObject(s) || !sameKeys(s, ["alias", "digest"])) fail("a session must be { alias, digest }");
    if (typeof s.alias !== "string" || !SESSION_ALIAS_RE.test(s.alias)) fail(`not a session alias: ${JSON.stringify(s.alias)}`);
    if (typeof s.digest !== "string" || !DIGEST_RE.test(s.digest)) fail("a session digest must be 16 hex");
    if (aliases.has(s.alias)) fail(`duplicate alias ${s.alias}`);
    aliases.add(s.alias);
  }

  if (!Array.isArray(raw.rules)) fail("rules must be an array");
  let tripped = 0;
  for (const r of raw.rules) {
    if (!isObject(r) || !sameKeys(r, RULE_KEYS)) fail(`a rule must carry ${RULE_KEYS.join(", ")}`);
    if (typeof r.id !== "string") fail("rule id must be a string");
    if (!Array.isArray(r.source) || !r.source.every((x) => typeof x === "string")) fail("rule source must be a string array");
    if (typeof r.unit !== "string") fail("rule unit must be a string");
    if (r.value !== null && typeof r.value !== "number") fail("rule value must be a number or null");
    if (r.reason !== null && typeof r.reason !== "string") fail("rule reason must be a string or null");
    if (!(RETRO_DISPOSITIONS as readonly unknown[]).includes(r.disposition)) fail(`unknown disposition ${JSON.stringify(r.disposition)}`);
    if (r.disposition === "tripped") tripped += 1;
  }

  if (raw.tripped_count !== tripped) fail(`tripped_count must be ${tripped}`);
  if (raw.suggested_severity !== severityFor(tripped)) fail(`suggested_severity must be ${JSON.stringify(severityFor(tripped))}`);
  return raw as unknown as RetroReport;
}

// audit_log — STE-108 AC-STE-108.7 helper, extended by STE-232 AC-STE-232.4
// and STE-237 AC-STE-237.6.
//
// Appends a `## /setup audit` row to CLAUDE.md when /setup resolves a Schema L
// answer. The audit section is the sole signal that a project was set up
// autonomously (or with pre-baked answers); reading it is sufficient signal
// for `/gate-check` probe `setup-audit-section-presence`.
//
// STE-232 extension: every row now carries an `imputed: true|false` column.
// `appendAuditRow(...)` is the canonical helper — it accepts `source` (one of
// the four canonical provenance values) and derives `imputed = source !==
// 'user-supplied'`. `appendAuditEntry(...)` is retained as a thin compatibility
// wrapper that derives `source` from the legacy `reason` argument so existing
// callers continue to work; new callers should pass `source` directly via
// `appendAuditRow`.
//
// STE-237 extension: rows additionally carry an optional `loop_entered:
// true|false` column. Set to `true` when /setup Steps 1–6 emitted at least
// one `AskUserQuestion` clarifier (the Socratic loop fired); `false` when
// the model proceeded without entering the loop. Pairs with `imputed:` for
// two-axis loop visibility — `imputed:` flags model-imputed values for
// gates that DID fire; `loop_entered:` flags loops that NEVER fired (the
// magpie regression class). Pre-STE-237 rows omit the column; the parser
// tolerates both shapes (see `parseAuditRow`).
//
// Pure file I/O. The skill prose decides *when* to append; this helper only
// formats and writes. See `docs/auto-mode-protocol.md` § Audit Trail for the
// cross-skill contract.

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const SECTION_HEADING = "## /setup audit";

/**
 * Canonical provenance of a Schema L resolution. STE-232 AC-STE-232.4.
 *
 * - `user-supplied` — interactive answer from a TTY prompt.
 * - `pre-baked` — answer supplied via CLI flag (e.g., `--tracker=linear`).
 * - `default-applied` — auto-approve marker (STE-226) present and a default
 *    existed.
 * - `model-imputed` — the model guessed; this should never happen on a
 *   well-formed run, but the column structurally distinguishes it from
 *   user-confirmed values when it does.
 */
export type AuditSource =
  | "user-supplied"
  | "pre-baked"
  | "default-applied"
  | "model-imputed";

export interface AuditRow {
  /** ISO date (`YYYY-MM-DD`). */
  date: string;
  /** Step identifier, e.g., `7b`, `7c`, `7d`. */
  step: string;
  /** Resolved field name, e.g., `tracker_mode`, `branch_template`. */
  field: string;
  /** Resolved value; serialized via `JSON.stringify` for round-trip safety. */
  value: unknown;
  /** Provenance — drives `imputed = source !== 'user-supplied'`. */
  source: AuditSource;
  /**
   * Optional free-form reason override. When omitted, the canonical
   * source-derived reason is rendered (`"user-supplied"` / `"pre-baked"` /
   * `"default applied"` / `"model-imputed"`). Adapters with finer-grained
   * provenance (e.g., `"MCP unregistered; deferred"`) pass an explicit
   * override here; the source still drives the `imputed:` column.
   */
  reason?: string;
  /**
   * STE-237 AC-STE-237.6 — `true` when /setup Steps 1–6 emitted at least one
   * `AskUserQuestion` clarifier (the Socratic loop fired); `false` when the
   * model proceeded without entering the loop. Optional for back-compat:
   * legacy callers omit it and the rendered row drops the column entirely;
   * the parser tolerates the absence (`loopEntered: undefined`).
   */
  loopEntered?: boolean;
}

/**
 * Legacy `appendAuditEntry` shape — kept for STE-108/STE-153 callers. New
 * code should use {@link AuditRow} + {@link appendAuditRow}.
 */
export interface AuditEntry {
  date: string;
  step: string;
  field: string;
  value: unknown;
  reason: string;
}

export interface ParsedAuditRow {
  date: string;
  step: string;
  field: string;
  value: unknown;
  reason: string;
  /** `undefined` for legacy rows pre-STE-232 (no `imputed:` column). */
  imputed?: boolean;
  /** `undefined` for rows pre-STE-237 (no `loop_entered:` column). */
  loopEntered?: boolean;
}

/**
 * Map a canonical `source` to its default `reason:` rendering. The mapping
 * preserves the historical reason strings (`"user-supplied"`, `"default applied"`)
 * so probe parsers and existing audit sections stay readable.
 */
function defaultReasonFor(source: AuditSource): string {
  switch (source) {
    case "user-supplied":
      return "user-supplied";
    case "pre-baked":
      return "pre-baked";
    case "default-applied":
      return "default applied";
    case "model-imputed":
      return "model-imputed";
  }
}

/**
 * Map a legacy `reason` to a best-guess `source`. Used by the
 * {@link appendAuditEntry} compatibility wrapper to derive the column.
 *
 * Heuristic: `"user-supplied"` ⇒ `'user-supplied'` (imputed=false); anything
 * else maps to `'default-applied'` (imputed=true). Adapters that need finer
 * granularity should call {@link appendAuditRow} directly.
 */
function sourceFromLegacyReason(reason: string): AuditSource {
  return reason.trim() === "user-supplied" ? "user-supplied" : "default-applied";
}

function renderRow(row: AuditRow): string {
  // JSON.stringify handles every value type uniformly, including escaping `"`
  // and `\` in strings — required so a value like `feat/{ticket-id}-"weird"`
  // round-trips through YAML-flavoured prose without breaking the row shape.
  const valueRendered = JSON.stringify(row.value);
  const reasonRendered = JSON.stringify(row.reason ?? defaultReasonFor(row.source));
  const imputed = row.source !== "user-supplied";
  const base = `- ${row.date} step:${row.step} (${row.field}) value:${valueRendered} reason:${reasonRendered} imputed:${imputed}`;
  return row.loopEntered === undefined
    ? base
    : `${base} loop_entered:${row.loopEntered}`;
}

/**
 * Append a row to CLAUDE.md's `## /setup audit` section. Idempotent in the
 * file-presence sense (creates the section if absent) but never de-duplicates —
 * append-only is the contract (STE-108 AC-STE-108.7).
 *
 * @throws Error if the CLAUDE.md file does not exist.
 */
export function appendAuditRow(claudeMdPath: string, row: AuditRow): void {
  if (!existsSync(claudeMdPath)) {
    throw new Error(
      `appendAuditRow: CLAUDE.md not found at ${claudeMdPath} — /setup must write the file before logging audit rows`,
    );
  }
  const content = readFileSync(claudeMdPath, "utf-8");
  const bullet = renderRow(row);
  const lines = content.split("\n");
  const sectionStart = lines.findIndex((l) => l === SECTION_HEADING);

  let next: string;
  if (sectionStart < 0) {
    const trimmed = content.replace(/\n+$/, "");
    next = `${trimmed}\n\n${SECTION_HEADING}\n\n${bullet}\n`;
  } else {
    let sectionEnd = lines.length;
    for (let i = sectionStart + 1; i < lines.length; i++) {
      if (/^##\s/.test(lines[i]!)) {
        sectionEnd = i;
        break;
      }
    }
    let lastBulletIdx = sectionStart;
    for (let i = sectionEnd - 1; i > sectionStart; i--) {
      if ((lines[i] ?? "").length > 0) {
        lastBulletIdx = i;
        break;
      }
    }
    const before = lines.slice(0, lastBulletIdx + 1);
    const after = lines.slice(lastBulletIdx + 1);
    next = [...before, bullet, ...after].join("\n");
  }
  writeFileSync(claudeMdPath, next);
}

/**
 * Backwards-compatibility wrapper for STE-108 / STE-153 callers that still
 * pass `reason`. Derives `source` via {@link sourceFromLegacyReason} and
 * delegates to {@link appendAuditRow}. New callers should use
 * {@link appendAuditRow} directly with an explicit `source`.
 */
export function appendAuditEntry(
  claudeMdPath: string,
  entry: AuditEntry,
): void {
  appendAuditRow(claudeMdPath, {
    date: entry.date,
    step: entry.step,
    field: entry.field,
    value: entry.value,
    source: sourceFromLegacyReason(entry.reason),
    reason: entry.reason,
  });
}

const ROW_RE =
  /^- (?<date>\d{4}-\d{2}-\d{2}) step:(?<step>\S+) \((?<field>[^)]+)\) value:(?<value>.+?) reason:(?<reason>"(?:[^"\\]|\\.)*")(?: imputed:(?<imputed>true|false))?(?: loop_entered:(?<loopEntered>true|false))?$/;

/**
 * Tolerantly parse a single audit-row line. Returns `null` when the line is
 * not an audit row (headings, blanks, prose). Returns the parsed shape with
 * `imputed: undefined` for legacy rows that pre-date the STE-232 column,
 * and `loopEntered: undefined` for rows that pre-date STE-237. Both columns
 * are independent: presence/absence permutations are tolerated.
 */
export function parseAuditRow(line: string): ParsedAuditRow | null {
  const m = ROW_RE.exec(line);
  if (!m || !m.groups) return null;
  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(m.groups.value!);
  } catch {
    parsedValue = m.groups.value!;
  }
  let parsedReason: string;
  try {
    parsedReason = JSON.parse(m.groups.reason!);
  } catch {
    parsedReason = m.groups.reason!;
  }
  const imputed =
    m.groups.imputed === undefined
      ? undefined
      : m.groups.imputed === "true";
  const loopEntered =
    m.groups.loopEntered === undefined
      ? undefined
      : m.groups.loopEntered === "true";
  return {
    date: m.groups.date!,
    step: m.groups.step!,
    field: m.groups.field!,
    value: parsedValue,
    reason: parsedReason,
    imputed,
    loopEntered,
  };
}

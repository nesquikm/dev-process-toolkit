// STE-302 — Per-project tracker-config.yaml loader + role/status mappers.
//
// `specs/tracker-config.yaml` declares the project's verbatim tracker statuses
// and the mapping from the canonical four-role enum to those statuses. The
// canonical roles — `initial`, `in_progress`, `in_review`, `done` — are the
// single tracker-agnostic vocabulary the rest of the toolkit speaks; each
// project declares how those roles map to its tracker's actual workflow
// labels (e.g., Linear's "Backlog" / "In Progress" / "In Review" / "Done").
//
// Schema:
//
//     tracker_key: linear            # or "jira"
//     statuses:                      # >= 1 entry, verbatim tracker labels
//       - Backlog
//       - In Progress
//       - In Review
//       - Done
//     roles:                         # MUST declare all four canonical roles
//       initial: Backlog             # value MUST appear in `statuses:`
//       in_progress: In Progress
//       in_review: In Review
//       done: Done
//
// Anything outside that surface throws `TrackerConfigShapeError` carrying
// the NFR-10 canonical refusal shape (Refusing: / Remedy: / Context:) so
// callers can render it verbatim. `readTrackerConfig` returns `null` when
// the file is absent — callers fall back to per-adapter defaults.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type TrackerKey = "linear" | "jira";

export type Role = "initial" | "in_progress" | "in_review" | "done";

export const CANONICAL_ROLES: readonly Role[] = ["initial", "in_progress", "in_review", "done"];

export interface TrackerConfig {
  tracker_key: TrackerKey;
  statuses: string[];
  roles: Record<Role, string>;
}

const SUPPORTED_TRACKER_KEYS: readonly string[] = ["linear", "jira"];

const CONFIG_FILENAME = "tracker-config.yaml";

/**
 * Thrown when the tracker-config file or in-memory object violates the
 * schema. NFR-10 canonical refusal shape: the message fuses
 * Refusing / Remedy / Context so callers can surface it verbatim.
 */
export class TrackerConfigShapeError extends Error {
  readonly reason: string;
  constructor(reason: string, remedy?: string, context?: string) {
    const remedyLine =
      remedy ?? "fix specs/tracker-config.yaml to conform to the documented schema and re-run.";
    const contextLine = context ?? `mode=tracker-config, file=specs/${CONFIG_FILENAME}`;
    super(
      [
        `Refusing: ${reason}`,
        `Remedy: ${remedyLine}`,
        `Context: ${contextLine}`,
      ].join("\n"),
    );
    this.name = "TrackerConfigShapeError";
    this.reason = reason;
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate a `TrackerConfig` against the schema invariants:
 *   - `tracker_key` is `linear` | `jira`
 *   - `statuses` is a non-empty array of strings
 *   - `roles` declares exactly the four canonical roles, each value MUST
 *     appear in `statuses`
 *
 * When `activeAdapterKey` is supplied, additionally enforces that the
 * config's `tracker_key` matches the running adapter — a mismatch usually
 * means the operator switched adapters without regenerating the config
 * and would otherwise produce silent vocabulary drift.
 */
export function validateTrackerConfig(
  config: TrackerConfig,
  activeAdapterKey?: string,
): void {
  if (!isPlainObject(config)) {
    throw new TrackerConfigShapeError(
      "tracker-config is not a mapping",
      undefined,
      "mode=tracker-config, stage=validate",
    );
  }

  // Cast once — the function accepts `TrackerConfig`, but in practice the
  // shape probe and `readTrackerConfig` hand us freshly-parsed YAML that
  // hasn't been validated yet. Treat the input as untrusted from here.
  const raw = config as unknown as Record<string, unknown>;

  const trackerKey = raw["tracker_key"];
  if (typeof trackerKey !== "string" || !SUPPORTED_TRACKER_KEYS.includes(trackerKey)) {
    throw new TrackerConfigShapeError(
      `tracker_key must be one of ${SUPPORTED_TRACKER_KEYS.join(", ")} — got ${JSON.stringify(trackerKey)}`,
      "set `tracker_key:` to `linear` or `jira` in specs/tracker-config.yaml.",
      "mode=tracker-config, stage=validate, field=tracker_key",
    );
  }

  const statuses = raw["statuses"];
  if (!Array.isArray(statuses)) {
    throw new TrackerConfigShapeError(
      "missing or non-array `statuses:` key",
      "declare `statuses:` as a YAML list of verbatim tracker labels (>=1 entry).",
      "mode=tracker-config, stage=validate, field=statuses",
    );
  }
  if (statuses.length === 0) {
    throw new TrackerConfigShapeError(
      "`statuses:` must contain >=1 entry",
      "list every tracker workflow label your project uses (verbatim, case-sensitive).",
      "mode=tracker-config, stage=validate, field=statuses",
    );
  }
  for (const s of statuses) {
    if (typeof s !== "string" || s.length === 0) {
      throw new TrackerConfigShapeError(
        `\`statuses:\` entries must be non-empty strings — got ${JSON.stringify(s)}`,
        undefined,
        "mode=tracker-config, stage=validate, field=statuses",
      );
    }
  }
  const statusList = statuses as string[];

  const rolesRaw = raw["roles"];
  if (!isPlainObject(rolesRaw)) {
    throw new TrackerConfigShapeError(
      "missing or non-mapping `roles:` key",
      "declare `roles:` as a mapping from each canonical role to a status from `statuses:`.",
      "mode=tracker-config, stage=validate, field=roles",
    );
  }

  // Missing canonical roles
  for (const role of CANONICAL_ROLES) {
    if (!(role in rolesRaw)) {
      throw new TrackerConfigShapeError(
        `\`roles:\` is missing canonical role \`${role}\``,
        `add a mapping like \`${role}: <one of statuses>\` to specs/${CONFIG_FILENAME}.`,
        `mode=tracker-config, stage=validate, field=roles.${role}`,
      );
    }
  }

  // Unknown extra roles
  for (const key of Object.keys(rolesRaw)) {
    if (!(CANONICAL_ROLES as readonly string[]).includes(key)) {
      throw new TrackerConfigShapeError(
        `\`roles:\` contains unknown role \`${key}\` — canonical four-role enum is locked at ${CANONICAL_ROLES.join(", ")}`,
        `remove \`${key}\` from \`roles:\` in specs/${CONFIG_FILENAME}; non-canonical workflow stops belong in \`statuses:\` only.`,
        `mode=tracker-config, stage=validate, field=roles.${key}`,
      );
    }
  }

  // Role value MUST appear in statuses
  for (const role of CANONICAL_ROLES) {
    const mapped = rolesRaw[role];
    if (typeof mapped !== "string" || mapped.length === 0) {
      throw new TrackerConfigShapeError(
        `\`roles.${role}\` must be a non-empty string — got ${JSON.stringify(mapped)}`,
        undefined,
        `mode=tracker-config, stage=validate, field=roles.${role}`,
      );
    }
    if (!statusList.includes(mapped)) {
      throw new TrackerConfigShapeError(
        `\`roles.${role}\` = \`${mapped}\` does not appear in \`statuses:\` (declared: ${statusList.join(", ")})`,
        `either add \`${mapped}\` to \`statuses:\` or change \`roles.${role}\` to a status that is already declared.`,
        `mode=tracker-config, stage=validate, field=roles.${role}`,
      );
    }
  }

  // Active-adapter mismatch (optional cross-reference)
  if (activeAdapterKey !== undefined && activeAdapterKey !== trackerKey) {
    throw new TrackerConfigShapeError(
      `tracker_key \`${trackerKey}\` does not match the active adapter \`${activeAdapterKey}\``,
      "regenerate specs/tracker-config.yaml with the active adapter, or switch adapters back so the tracker vocabulary matches.",
      `mode=tracker-config, stage=validate, active=${activeAdapterKey}, config=${trackerKey}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Role / status mappers
// ---------------------------------------------------------------------------

/**
 * Map a canonical role to the project's configured status string. Throws
 * `TrackerConfigShapeError` when `role` is outside the canonical four-value
 * enum — guards against typo'd role names producing silent fallback writes.
 */
export function roleToStatus(config: TrackerConfig, role: Role): string {
  if (!(CANONICAL_ROLES as readonly string[]).includes(role)) {
    throw new TrackerConfigShapeError(
      `unknown role \`${role}\` — canonical four-role enum is locked at ${CANONICAL_ROLES.join(", ")}`,
      "pass one of the canonical roles to roleToStatus.",
      `mode=tracker-config, stage=roleToStatus, role=${role}`,
    );
  }
  return config.roles[role];
}

/**
 * Map a tracker status string back to the canonical role.
 *
 *   - Returns the role name when `status` maps to a role.
 *   - Returns `null` for known-non-key statuses (declared in `statuses:`
 *     but not bound to any role — e.g., "In QA" workflow stops).
 *   - Returns `"unknown"` sentinel for statuses not in `statuses:` at all
 *     (tracker drift, typo, or a workflow stop the operator forgot to
 *     declare).
 *
 * Never throws — even genuinely weird input (empty string, garbage) is
 * classified as `"unknown"`. Callers decide how to escalate.
 */
export function statusToRole(config: TrackerConfig, status: string): Role | null | "unknown" {
  if (!config.statuses.includes(status)) {
    return "unknown";
  }
  for (const role of CANONICAL_ROLES) {
    if (config.roles[role] === status) {
      return role;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Read / Write
// ---------------------------------------------------------------------------

function configPath(specsDir: string): string {
  return join(specsDir, CONFIG_FILENAME);
}

/**
 * Read `<specsDir>/tracker-config.yaml` and return a validated
 * `TrackerConfig`. Absent file returns `null` — callers fall back to the
 * per-adapter default vocabulary. Malformed YAML or schema violations
 * throw `TrackerConfigShapeError`.
 */
export function readTrackerConfig(specsDir: string): TrackerConfig | null {
  const path = configPath(specsDir);
  if (!existsSync(path)) {
    return null;
  }

  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    throw new TrackerConfigShapeError(
      `cannot read specs/${CONFIG_FILENAME}: ${err instanceof Error ? err.message : String(err)}`,
      undefined,
      `mode=tracker-config, stage=read, path=${path}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(raw);
  } catch (err) {
    throw new TrackerConfigShapeError(
      `specs/${CONFIG_FILENAME} is not valid YAML: ${err instanceof Error ? err.message : String(err)}`,
      "fix the YAML syntax (check indentation, colons, and quoting).",
      `mode=tracker-config, stage=parse, path=${path}`,
    );
  }

  if (!isPlainObject(parsed)) {
    throw new TrackerConfigShapeError(
      `specs/${CONFIG_FILENAME} top-level must be a mapping, got ${Array.isArray(parsed) ? "array" : typeof parsed}`,
      undefined,
      `mode=tracker-config, stage=parse, path=${path}`,
    );
  }

  const config = parsed as TrackerConfig;
  validateTrackerConfig(config);
  return config;
}

/**
 * Serialize a `TrackerConfig` to `<specsDir>/tracker-config.yaml`. Refuses
 * to write when the config violates the schema — the file on disk is the
 * one source of truth, so writing a known-bad config would just propagate
 * the failure to the next read.
 */
export function writeTrackerConfig(specsDir: string, config: TrackerConfig): void {
  validateTrackerConfig(config);
  const path = configPath(specsDir);
  writeFileSync(path, serializeConfig(config));
}

/**
 * Hand-rolled block-style YAML writer for the tracker-config schema. We
 * use a custom serializer rather than `Bun.YAML.stringify` because the
 * latter currently produces flow-style (inline) YAML, which is valid but
 * unreadable for humans editing the file by hand. The schema is small
 * and fixed, so a 10-line writer is cheaper than dragging in a YAML dep.
 */
function serializeConfig(config: TrackerConfig): string {
  const lines: string[] = [];
  lines.push(`tracker_key: ${config.tracker_key}`);
  lines.push("statuses:");
  for (const s of config.statuses) {
    lines.push(`  - ${s}`);
  }
  lines.push("roles:");
  for (const role of CANONICAL_ROLES) {
    lines.push(`  ${role}: ${config.roles[role]}`);
  }
  lines.push("");
  return lines.join("\n");
}

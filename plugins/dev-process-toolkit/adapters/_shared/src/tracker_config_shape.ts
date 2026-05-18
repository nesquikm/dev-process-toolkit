// tracker_config_shape — /gate-check probe (STE-302 AC-STE-302.8).
//
// Byte-checks `specs/tracker-config.yaml` shape when the file exists.
// Schema invariants enforced via `validateTrackerConfig` from
// `tracker_config.ts` (AC.2 + AC.3 + AC.4):
//   - `tracker_key` is `linear` | `jira` and matches the active adapter
//     declared by CLAUDE.md `## Task Tracking` `mode:`
//   - `statuses` is a non-empty list of verbatim tracker labels
//   - `roles` declares exactly the canonical four-role enum
//     (initial / in_progress / in_review / done), every value present in
//     `statuses`
//
// Vacuous when:
//   - `specs/tracker-config.yaml` is absent (FR2 owns creation)
//   - `## Task Tracking` `mode: none` is declared (no tracker-config used)
//
// Mirrors the shape of `runArchivePlanStatusProbe` (probe #16) — returns a
// `violations: TrackerConfigShapeViolation[]` report with `file:line —
// reason` notes in NFR-10 canonical shape so callers can render them
// verbatim.

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { readTaskTrackingSection } from "./resolver_config";
import { TrackerConfigShapeError, validateTrackerConfig } from "./tracker_config";

const CONFIG_RELPATH = join("specs", "tracker-config.yaml");

export interface TrackerConfigShapeViolation {
  file: string;
  line: number;
  reason: string;
  /** `file:line — reason` per NFR-10 / STE-82. */
  note: string;
  /** NFR-10 canonical multi-line `Refusing: / Remedy: / Context:` shape. */
  message: string;
}

export interface TrackerConfigShapeReport {
  violations: TrackerConfigShapeViolation[];
}

/**
 * Attempt to find the 1-based line number where `key` is declared at the
 * top of the YAML document. Returns 1 when the key is not found — we'd
 * rather point the operator at the file than emit a confusing 0.
 *
 * Cheap line scan: only recognizes top-level keys (no leading whitespace),
 * which is sufficient for tracker-config.yaml's flat schema. The nested
 * `roles.<role>` violations are surfaced at the `roles:` line; the operator
 * sees the offending value verbatim in the reason text.
 */
function findKeyLine(raw: string, key: string): number {
  const lines = raw.split("\n");
  const needle = new RegExp(`^${key}:`);
  for (let i = 0; i < lines.length; i++) {
    if (needle.test(lines[i]!)) return i + 1;
  }
  return 1;
}

/**
 * Best-effort line-number resolver for a TrackerConfigShapeError. Inspects
 * the error's `context` line (e.g., `field=statuses`, `field=roles.in_review`)
 * and locates the corresponding top-level key in the YAML source.
 */
function resolveErrorLine(raw: string, err: TrackerConfigShapeError): number {
  const ctx = err.message;
  const m = /field=([A-Za-z_]+)(?:\.([A-Za-z_]+))?/.exec(ctx);
  if (!m) return 1;
  const topKey = m[1]!;
  return findKeyLine(raw, topKey);
}

function buildMessage(reason: string, remedy: string, context: string): string {
  return [
    `tracker_config_shape: Refusing: ${reason}`,
    `Remedy: ${remedy}`,
    `Context: ${context}`,
  ].join("\n");
}

/**
 * Push a single violation with the standard shape: `note` is always
 * `<CONFIG_RELPATH>:<line> — <reason>` and `message` is built from
 * `Refusing / Remedy / Context`. Centralizes the four pre-validate
 * failure paths (read error, YAML parse error, non-mapping top-level,
 * unexpected validator error) so they cannot drift apart.
 */
function pushPreValidateViolation(
  violations: TrackerConfigShapeViolation[],
  configPath: string,
  reason: string,
  remedy: string,
  context: string,
): void {
  violations.push({
    file: configPath,
    line: 1,
    reason,
    note: `${CONFIG_RELPATH}:1 — ${reason}`,
    message: buildMessage(reason, remedy, context),
  });
}

/**
 * Scan `specs/tracker-config.yaml` under `projectRoot` and return the list
 * of shape violations. Pure function — no side effects, no writes.
 *
 * Vacuous when the file is absent or CLAUDE.md declares `mode: none`. The
 * probe never reads the YAML in those cases, so even a malformed file is
 * inert under `mode: none`.
 *
 * Call site: `/gate-check` v2 conformance probes (probe `tracker_config_shape`)
 * + the integration test at `tests/gate-check-tracker-config-shape.test.ts`.
 */
export async function runTrackerConfigShapeProbe(
  projectRoot: string,
): Promise<TrackerConfigShapeReport> {
  const violations: TrackerConfigShapeViolation[] = [];

  // mode: none short-circuit — never read the YAML.
  const claudeMdPath = join(projectRoot, "CLAUDE.md");
  const tracking = readTaskTrackingSection(claudeMdPath);
  const mode = tracking["mode"] ?? "none";
  if (mode === "none") {
    return { violations };
  }

  // File-absent short-circuit — FR2 owns the write step.
  const configPath = join(projectRoot, CONFIG_RELPATH);
  if (!existsSync(configPath)) {
    return { violations };
  }

  // Read the file. I/O failures route through the same NFR-10 shape.
  let raw: string;
  try {
    raw = readFileSync(configPath, "utf8");
  } catch (err) {
    pushPreValidateViolation(
      violations,
      configPath,
      `cannot read ${CONFIG_RELPATH}: ${err instanceof Error ? err.message : String(err)}`,
      "fix filesystem permissions on specs/tracker-config.yaml and re-run /gate-check.",
      `mode=tracker-config, stage=read, path=${configPath}`,
    );
    return { violations };
  }

  // YAML-parse failure → NFR-10 violation.
  let parsed: unknown;
  try {
    parsed = Bun.YAML.parse(raw);
  } catch (err) {
    pushPreValidateViolation(
      violations,
      configPath,
      `${CONFIG_RELPATH} is not valid YAML: ${err instanceof Error ? err.message : String(err)}`,
      "fix the YAML syntax (check indentation, colons, and quoting) and re-run /gate-check.",
      `mode=tracker-config, stage=parse, path=${configPath}`,
    );
    return { violations };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    const observed = parsed === null ? "null" : Array.isArray(parsed) ? "array" : typeof parsed;
    pushPreValidateViolation(
      violations,
      configPath,
      `${CONFIG_RELPATH} top-level must be a mapping, got ${observed}`,
      "rewrite specs/tracker-config.yaml as a YAML mapping with `tracker_key:`, `statuses:`, `roles:` keys.",
      `mode=tracker-config, stage=parse, path=${configPath}`,
    );
    return { violations };
  }

  // Schema validation via the canonical authority — passes the active
  // adapter key so the cross-check arm fires (mode: linear + tracker_key:
  // jira ⇒ violation).
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    validateTrackerConfig(parsed as any, mode);
  } catch (err) {
    if (err instanceof TrackerConfigShapeError) {
      const line = resolveErrorLine(raw, err);
      // The error's `message` already carries `Refusing: / Remedy: / Context:`.
      // Prefix with the probe name to match peer probes (archive_plan_status etc.).
      violations.push({
        file: configPath,
        line,
        reason: err.reason,
        note: `${CONFIG_RELPATH}:${line} — ${err.reason}`,
        message: `tracker_config_shape: ${err.message}`,
      });
    } else {
      pushPreValidateViolation(
        violations,
        configPath,
        `unexpected error validating ${CONFIG_RELPATH}: ${err instanceof Error ? err.message : String(err)}`,
        "report the unexpected error shape — tracker_config_shape probe only knows TrackerConfigShapeError.",
        `mode=tracker-config, stage=validate, path=${configPath}`,
      );
    }
  }

  return { violations };
}

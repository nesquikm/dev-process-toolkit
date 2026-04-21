// Layout marker reader (FR-47, AC-47.2/4).
//
// Reads `specs/.dpt-layout` (Schema R) and returns the `version:` field.
// Missing file throws unless `allowMissing: true` is passed — that option is
// the documented /setup exemption (AC-47.4), since /setup implements the
// migration and cannot require the marker to exist on entry.
//
// YAML parsing is intentionally minimal — the file is 2–3 lines in practice
// and pulling a full YAML library would be overkill. We parse only the
// `key: value` lines we need (version, migrated_at, migration_commit).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface LayoutMarker {
  version: string;
  migrated_at: string;
  migration_commit: string | null;
}

export interface LayoutOptions {
  allowMissing?: boolean;
}

const VERSION_RE = /^v\d+$/;

function parseSimpleYaml(text: string): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon < 0) {
      throw new Error(`dpt-layout: malformed YAML at line ${i + 1}: missing ':' in "${raw}"`);
    }
    const key = line.slice(0, colon).trim();
    let rest = line.slice(colon + 1).trim();
    // Reject unterminated quotes — a quoted value must open and close on the same line.
    if ((rest.startsWith('"') && !rest.endsWith('"')) || (rest.startsWith("'") && !rest.endsWith("'"))) {
      throw new Error(`dpt-layout: malformed YAML at line ${i + 1}: unterminated quote`);
    }
    if (rest.startsWith('"') && rest.endsWith('"') && rest.length >= 2) rest = rest.slice(1, -1);
    else if (rest.startsWith("'") && rest.endsWith("'") && rest.length >= 2) rest = rest.slice(1, -1);
    out[key] = rest === "null" || rest === "" ? null : rest;
  }
  return out;
}

export function readLayoutMarker(specsDir: string, options: LayoutOptions = {}): LayoutMarker | null {
  const path = join(specsDir, ".dpt-layout");
  if (!existsSync(path)) {
    if (options.allowMissing) return null;
    throw new Error(`dpt-layout: missing ${path}. Run /dev-process-toolkit:setup to migrate.`);
  }
  const text = readFileSync(path, "utf-8");
  const parsed = parseSimpleYaml(text);
  const version = parsed["version"];
  if (version === undefined || version === null) {
    throw new Error(`dpt-layout: ${path} is missing required 'version' field`);
  }
  if (!VERSION_RE.test(version)) {
    throw new Error(`dpt-layout: ${path} has invalid 'version: ${version}' (expected ^v\\d+$)`);
  }
  const migrated_at = parsed["migrated_at"] ?? "";
  const migration_commit = parsed["migration_commit"] ?? null;
  return { version, migrated_at, migration_commit };
}

export function readLayoutVersion(specsDir: string, options: LayoutOptions = {}): string | null {
  const marker = readLayoutMarker(specsDir, options);
  return marker?.version ?? null;
}

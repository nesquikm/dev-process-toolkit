// M108 STE-391 AC-STE-391.1 — the version-ordered consumer-artifact migration
// registry walked by `/dev-process-toolkit:upgrade`.
//
// Each entry pairs a pure, synchronous, network-free detector with either a
// scripted fix (`kind: "script"`, carries `apply`) or an operator-guided flow
// (`kind: "assisted"`, no `apply` — its flow lives in skill prose). The list
// is ordered ascending by `introduced_in`, the release that made the legacy
// state legacy, and `validateRegistry` enforces the dup-id and ordering
// invariants at module load. Retired path literals live exclusively in
// `./legacy_paths` — the entries import them, never compose them.

import { m104LegacyState } from "./entries/m104_legacy_state";
import { permissionShapes } from "./entries/permission_shapes";
import { staleHookEntries } from "./entries/stale_hook_entries";
import { v1Orphans } from "./entries/v1_orphans";
import { monolithSplit } from "./monolith_split";

/** What a detector reports: does the legacy state exist, and where. */
export interface DetectResult {
  applies: boolean;
  evidence: string[];
}

/** What a scripted fix reports for the diff-preview surface. */
export interface ApplyResult {
  changed: string[];
  summary: string;
}

export interface MigrationEntry {
  /** Unique across the registry. */
  id: string;
  /** Semver of the release that made the legacy state legacy. */
  introduced_in: string;
  title: string;
  kind: "script" | "assisted";
  /**
   * AC-STE-391.6 rail: never auto-apply — explicit per-entry operator
   * approval required even when the auto-approve marker is present.
   */
  requires_explicit_approval?: boolean;
  /** Pure, deterministic, filesystem-only predicate. Never mutates. */
  detect(projectRoot: string): DetectResult;
  /** Scripted fix — present exactly when `kind` is "script". */
  apply?(projectRoot: string): ApplyResult;
}

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)$/;

function versionTuple(entry: MigrationEntry): [number, number, number] {
  const m = entry.introduced_in.match(SEMVER);
  if (m === null) {
    throw new Error(
      `Migration registry: entry "${entry.id}" has malformed introduced_in version "${entry.introduced_in}" (expected MAJOR.MINOR.PATCH)`,
    );
  }
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function ascends(a: [number, number, number], b: [number, number, number]): boolean {
  if (a[0] !== b[0]) return a[0] < b[0];
  if (a[1] !== b[1]) return a[1] < b[1];
  return a[2] <= b[2];
}

/**
 * Load-time invariants: unique `id`s, ascending `introduced_in`. Throws on
 * the first violation. Exported so tests can feed it deliberately bad lists;
 * the module itself calls it on `MIGRATIONS` below.
 */
export function validateRegistry(entries: readonly MigrationEntry[]): void {
  const seen = new Set<string>();
  let prev: MigrationEntry | null = null;
  for (const entry of entries) {
    if (seen.has(entry.id)) {
      throw new Error(`Migration registry: duplicate migration id "${entry.id}"`);
    }
    seen.add(entry.id);
    if (prev !== null && !ascends(versionTuple(prev), versionTuple(entry))) {
      throw new Error(
        `Migration registry: introduced_in must be ascending — "${entry.id}" (${entry.introduced_in}) sorts before "${prev.id}" (${prev.introduced_in})`,
      );
    }
    prev = entry;
  }
}

/** The version-ordered registry. Seeded per AC-STE-391.3..6. */
export const MIGRATIONS: MigrationEntry[] = [
  monolithSplit, // 1.16.0 — assisted
  v1Orphans, // 1.20.0
  permissionShapes, // 2.7.0
  staleHookEntries, // 2.22.2
  m104LegacyState, // 2.46.0
];

validateRegistry(MIGRATIONS);

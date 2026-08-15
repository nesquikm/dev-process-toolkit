// STE-468 — Template-source reuse analyzer.
//
// `analyzeTemplateSource(sourceRoot)` inventories an existing project
// directory as a reuse template: pure synchronous file reads (node:fs),
// zero mutation of the source tree, no git subprocess, no network. The
// inventory carries four categories:
//
//   - processConfig   — toolkit process files (CLAUDE.md,
//                       .claude/settings.json, .mcp.json, git-hook
//                       templates), classified by `PROCESS_CONFIG_FILES`.
//   - manifests       — per-entry rows for specs/deps.yaml and
//                       specs/best-practices.yaml, delegated to the
//                       canonical manifest modules (`deps_manifest.ts`,
//                       `best_practices_manifest.ts`) — never re-parsed
//                       ad hoc. A malformed manifest surfaces as a
//                       category-level warning, never a hard failure.
//   - scaffolding     — known build/CI/lint configs by name detection,
//                       classified by `SCAFFOLDING_CONFIG_NAMES`.
//   - sourcePatterns  — top-level source trees, listing only (dot-dirs
//                       and `SOURCE_TREE_EXCLUDES` never classify).
//
// plus `wholeProjectCandidate` (all three file-ish categories populated ⇒
// the tree is plausibly cloneable wholesale) and `isGitRepo` (a `.git`
// entry exists — its absence is legal, recorded, never refused).
//
// A missing or non-directory `sourceRoot` throws
// `TemplateSourceRefusalError` carrying the NFR-10 canonical refusal
// shape (Refusing: ... / Remedy: ... / Context: ...) so callers can
// surface the failure verbatim to the operator (sibling-module
// convention — see deps_manifest.ts, best_practices_manifest.ts).

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  BestPracticesManifestShapeError,
  readManifest as readBestPracticesManifest,
  type BestPracticesEntry,
} from "./best_practices_manifest";
import {
  DepsManifestShapeError,
  readManifest as readDepsManifest,
  type DepsEntry,
} from "./deps_manifest";

// ---------------------------------------------------------------------------
// Classifier vocabularies — exported consts shared with consumers.
// ---------------------------------------------------------------------------

/**
 * Process-config classifier: source-root-relative paths inventoried into
 * `processConfig`. Disjoint from `SCAFFOLDING_CONFIG_NAMES` — a name
 * never classifies twice.
 */
export const PROCESS_CONFIG_FILES: readonly string[] = [
  "CLAUDE.md",
  ".claude/settings.json",
  ".mcp.json",
  // Git-hook templates: the installed hook and the toolkit template copy.
  ".git/hooks/commit-msg",
  "templates/git-hooks/commit-msg.sh",
];

/**
 * Scaffolding classifier: known build/CI/lint config names detected at
 * the source root. Directory entries (e.g. `.github/workflows`) classify
 * by listing their contained files.
 */
export const SCAFFOLDING_CONFIG_NAMES: readonly string[] = [
  "package.json",
  "tsconfig.json",
  "bunfig.toml",
  "biome.json",
  ".eslintrc.json",
  "pyproject.toml",
  "pubspec.yaml",
  "analysis_options.yaml",
  "Makefile",
  ".github/workflows",
];

/**
 * Source-pattern excludes: top-level directory names that never classify
 * as source trees (dot-prefixed directories are excluded by rule).
 */
export const SOURCE_TREE_EXCLUDES: readonly string[] = [
  "node_modules",
  "specs",
  "docs",
  "dist",
  "build",
  "out",
  "coverage",
  "vendor",
  "target",
  "tmp",
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TemplateManifestsInventory {
  deps: DepsEntry[];
  bestPractices: BestPracticesEntry[];
  /** Category-level warnings (one per malformed manifest) — never a hard failure. */
  warnings: string[];
}

export interface TemplateSourceInventory {
  processConfig: { files: string[] };
  manifests: TemplateManifestsInventory;
  scaffolding: { files: string[] };
  sourcePatterns: { dirs: string[] };
  wholeProjectCandidate: boolean;
  isGitRepo: boolean;
}

/**
 * Thrown when `sourceRoot` is missing or not a directory. The message
 * follows the NFR-10 canonical refusal shape — Refusing / Remedy /
 * Context lines — so callers can render it verbatim without
 * re-templating.
 */
export class TemplateSourceRefusalError extends Error {
  readonly reason: string;
  constructor(reason: string, remedy?: string, context?: string) {
    const remedyLine = remedy ?? "pass an existing directory as the template source root and re-run.";
    const contextLine = context ?? "mode=template-source-analyzer";
    super(
      [
        `Refusing: ${reason}`,
        `Remedy: ${remedyLine}`,
        `Context: ${contextLine}`,
      ].join("\n"),
    );
    this.name = "TemplateSourceRefusalError";
    this.reason = reason;
  }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * `statSync` that returns `null` instead of throwing — a foreign template
 * tree can carry dangling symlinks (readdir lists them, stat follows and
 * throws ENOENT); a broken entry is skipped, never a crash.
 */
function statOrNull(path: string): ReturnType<typeof statSync> | null {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

/**
 * Resolve one classifier path against `sourceRoot`: a file classifies as
 * itself; a directory classifies by listing its directly contained files
 * (source-root-relative paths, sorted). Absent entries contribute nothing.
 */
function classifyPath(sourceRoot: string, relPath: string): string[] {
  const abs = join(sourceRoot, relPath);
  if (!existsSync(abs)) return [];
  const st = statSync(abs);
  if (st.isFile()) return [relPath];
  if (!st.isDirectory()) return [];
  return readdirSync(abs)
    .sort()
    .filter((name) => statOrNull(join(abs, name))?.isFile() ?? false)
    .map((name) => `${relPath}/${name}`);
}

/**
 * Read one manifest via its canonical module, converting a shape refusal
 * into a category-level warning (the analyzer inventories a foreign tree
 * — a broken manifest there is a finding, not a crash). Non-shape errors
 * propagate: they signal analyzer bugs, not template defects.
 */
function readManifestRows<T>(
  read: () => T[],
  warnings: string[],
): T[] {
  try {
    return read();
  } catch (err) {
    if (
      err instanceof DepsManifestShapeError ||
      err instanceof BestPracticesManifestShapeError
    ) {
      warnings.push(err.reason);
      return [];
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyze `sourceRoot` as a template source and return the typed reuse
 * inventory. Pure file reads — the source tree is never mutated. A
 * missing or non-directory `sourceRoot` throws
 * `TemplateSourceRefusalError` (NFR-10 canonical shape); a non-git
 * directory is a legal source and merely records `isGitRepo: false`.
 */
export function analyzeTemplateSource(sourceRoot: string): TemplateSourceInventory {
  if (!existsSync(sourceRoot)) {
    throw new TemplateSourceRefusalError(
      `template source root \`${sourceRoot}\` does not exist`,
      undefined,
      `mode=template-source-analyzer, sourceRoot=${sourceRoot}`,
    );
  }
  if (!statSync(sourceRoot).isDirectory()) {
    throw new TemplateSourceRefusalError(
      `template source root \`${sourceRoot}\` is not a directory`,
      undefined,
      `mode=template-source-analyzer, sourceRoot=${sourceRoot}`,
    );
  }

  // Process config + scaffolding — classifier-vocabulary name detection.
  const processConfigFiles = PROCESS_CONFIG_FILES.flatMap((p) => classifyPath(sourceRoot, p));
  const scaffoldingFiles = SCAFFOLDING_CONFIG_NAMES.flatMap((p) => classifyPath(sourceRoot, p));

  // Manifests — delegated to the canonical manifest modules.
  const specsDir = join(sourceRoot, "specs");
  const warnings: string[] = [];
  const deps = readManifestRows(() => readDepsManifest(specsDir).deps, warnings);
  const bestPractices = readManifestRows(
    () => readBestPracticesManifest(specsDir).best_practices,
    warnings,
  );

  // Source patterns — top-level source trees, listing only.
  const sourceDirs = readdirSync(sourceRoot)
    .sort()
    .filter((name) => {
      if (name.startsWith(".")) return false;
      if (SOURCE_TREE_EXCLUDES.includes(name)) return false;
      return statOrNull(join(sourceRoot, name))?.isDirectory() ?? false;
    });

  return {
    processConfig: { files: processConfigFiles },
    manifests: { deps, bestPractices, warnings },
    scaffolding: { files: scaffoldingFiles },
    sourcePatterns: { dirs: sourceDirs },
    wholeProjectCandidate:
      processConfigFiles.length > 0 && scaffoldingFiles.length > 0 && sourceDirs.length > 0,
    isGitRepo: existsSync(join(sourceRoot, ".git")),
  };
}

// ---------------------------------------------------------------------------
// CLI shim
// ---------------------------------------------------------------------------
//
// `bun run template_source_analyzer.ts <source-root>` prints the JSON
// inventory on stdout (exit 0). A refusal (missing argument, missing or
// non-directory source root) prints the NFR-10 canonical message verbatim
// on stderr and exits 2. The entry guard keeps imports (tests, sibling
// modules) side-effect free — sibling-module convention, see
// check_marker_runtime.ts / upgrade_staleness.ts.
if (import.meta.main) {
  const sourceRoot = process.argv[2];
  if (sourceRoot === undefined || sourceRoot === "") {
    process.stderr.write(
      new TemplateSourceRefusalError(
        "missing <source-root> argument",
        "invoke as: bun run template_source_analyzer.ts <source-root>",
        "mode=template-source-analyzer, sourceRoot=(absent)",
      ).message + "\n",
    );
    process.exit(2);
  }
  try {
    process.stdout.write(
      JSON.stringify(analyzeTemplateSource(sourceRoot), null, 2) + "\n",
    );
  } catch (err) {
    if (err instanceof TemplateSourceRefusalError) {
      process.stderr.write(err.message + "\n");
      process.exit(2);
    }
    throw err;
  }
}

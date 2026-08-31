// ------------------------------------------------ the REUSABLE consumer guard
//
// A module under `adapters/_shared/src/` whose only referents are test files is
// a defect: it cannot fire in production, so every test over it is measuring
// nothing that ships. The guard below answers one question for ANY module —
// "which NON-TEST files reference it?" — and is written to be pointed at a
// second module by a later FR without modification.
//
// It was born inside `tests/m137-ste-535-plan-narrative-cap.test.ts` (STE-535)
// with the note "written to be pointed at a second module by a later FR without
// modification". STE-533 is that later FR, and a SECOND private copy of the walk
// is exactly the two-renderers defect this repository has already recorded — so
// the guard moved here, to the one place both suites read it from.
//
// One trap is baked in deliberately. The first attempt at this measurement
// piped `grep -rn <module>` through `grep -v '\.test\.ts'` and reported the FR
// scanner as having ZERO non-test references — because probe #67's own
// registration line ENDS with "Test coverage: `tests/<name>.test.ts`", so filtering
// by LINE CONTENT deleted the single real consumer. The guard therefore classifies
// by FILE PATH and never by line text, and a test pins exactly that.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** The plugin root — `plugins/dev-process-toolkit`, this file's parent's parent. */
export const CONSUMER_SEARCH_ROOT = join(import.meta.dir, "..");

export interface ConsumerRef {
  /** Search-root-relative path, POSIX separators. */
  file: string;
  /** 1-indexed line the reference sits on. */
  line: number;
  /** The referencing line, verbatim. */
  text: string;
}

const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".md", ".json", ".sh", ".bash", ".yaml", ".yml",
]);
const WALK_SKIP_DIRS = new Set([
  "node_modules", ".git", ".dpt", "dist", "build", "coverage", ".bun",
]);

/** True iff `rel` is a TEST file, decided from the PATH alone. */
export function isTestPath(rel: string): boolean {
  const parts = rel.split("/");
  const leaf = parts[parts.length - 1] ?? "";
  return (
    parts.slice(0, -1).some((p) => p === "tests" || p === "__tests__") ||
    /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(leaf)
  );
}

const walkCache = new Map<string, string[]>();

/** Every text file under `root`, search-root-relative, POSIX separators. */
export function walkTextFiles(root: string): string[] {
  const cached = walkCache.get(root);
  if (cached !== undefined) return cached;
  const out: string[] = [];
  const visit = (absDir: string, relDir: string): void => {
    let entries;
    try {
      entries = readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const rel = relDir === "" ? e.name : `${relDir}/${e.name}`;
      if (e.isDirectory()) {
        if (WALK_SKIP_DIRS.has(e.name)) continue;
        visit(join(absDir, e.name), rel);
      } else if (e.isFile()) {
        const dot = e.name.lastIndexOf(".");
        if (dot > 0 && TEXT_EXTENSIONS.has(e.name.slice(dot))) out.push(rel);
      }
    }
  };
  visit(root, "");
  out.sort();
  walkCache.set(root, out);
  return out;
}

/**
 * Every NON-TEST reference to `moduleRel` under `searchRoot`.
 *
 * GENERAL by construction: the only inputs are a module path and a root, so a
 * later FR points it at a second module unchanged. A module's own file is
 * excluded — a header comment naming itself is not a consumer. Test files are
 * excluded by PATH, never by line content.
 */
export function nonTestConsumers(
  moduleRel: string,
  searchRoot: string = CONSUMER_SEARCH_ROOT,
): ConsumerRef[] {
  const leaf = moduleRel.split("/").pop() ?? moduleRel;
  const stem = leaf.replace(/\.[^.]+$/, "");
  const needles = [moduleRel, leaf, stem];
  const refs: ConsumerRef[] = [];
  for (const rel of walkTextFiles(searchRoot)) {
    if (rel === moduleRel) continue;
    if (isTestPath(rel)) continue;
    let content: string;
    try {
      content = readFileSync(join(searchRoot, ...rel.split("/")), "utf-8");
    } catch {
      continue;
    }
    content.split("\n").forEach((text, i) => {
      if (needles.some((n) => text.includes(n))) {
        refs.push({ file: rel, line: i + 1, text });
      }
    });
  }
  return refs;
}

/** The distinct non-test files that reference `moduleRel`. */
export const consumerFiles = (
  moduleRel: string,
  searchRoot?: string,
): string[] => [
  ...new Set(
    (searchRoot === undefined
      ? nonTestConsumers(moduleRel)
      : nonTestConsumers(moduleRel, searchRoot)
    ).map((r) => r.file),
  ),
];

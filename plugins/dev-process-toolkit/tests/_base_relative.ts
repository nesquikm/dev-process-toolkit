// Helpers for tests that compare the working tree against a git ref (STE-692).
//
// A ref like `main` is the pre-release tree on a release branch and IS the
// release once merged, so anything read from it must recognise every shape
// the release ships, not only the shape the branch started from.

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";

/**
 * One source line carrying a stamp-shaped regex literal, in either shipped
 * form: the old `/^v\d…` / `/^v(\d…`, and the shared grammar
 * `/^(?:v\d…|unreleased)` / `/^(?:v(\d…|unreleased)`. An optional `v` (`/^v?`)
 * is a version parser, not a stamp literal, and does not match.
 */
export const STAMP_LITERAL_RE = /\/\^(?:\(\?:)?v\(?\\d/;

/** Lines of `src` carrying a stamp-shaped regex literal. */
export function stampLiteralCount(src: string): number {
  return src.split("\n").filter((l) => STAMP_LITERAL_RE.test(l)).length;
}

/**
 * Modules whose live stamp-literal count exceeds max(main count, 1): a module's
 * first literal is not a gain, a second one of either form is. Rendered
 * `<file>: <was> on main -> <now> now`, in `live`'s iteration order.
 */
export function grownStampModules(onMain: Map<string, number>, live: Map<string, string>): string[] {
  return [...live]
    .map(([f, src]) => ({ f, now: stampLiteralCount(src), was: onMain.get(f) ?? 0 }))
    .filter(({ now, was }) => now > Math.max(was, 1))
    .map(({ f, now, was }) => `${f}: ${was} on main -> ${now} now`);
}

/**
 * Per-basename stamp-literal counts for the files matching `pathspec` on `ref`,
 * graded by the same STAMP_LITERAL_RE in-process. `git grep` only prefilters
 * candidate lines (every stamp literal starts with `/^`). A git `*` crosses
 * `/`, so only files directly in the pathspec's directory are counted, the
 * same files a `readdirSync` of the live directory sees.
 */
export function stampLiteralCountsAt(cwd: string, ref: string, pathspec: string): Map<string, number> {
  const proc = spawnSync("git", ["grep", "-n", "-E", "/\\^", ref, "--", pathspec], {
    cwd,
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  });
  // git grep exits 0 with matches and 1 with none; anything else is a broken read.
  if (proc.status !== 0 && proc.status !== 1) {
    throw new Error(`git grep on ${ref} failed (${proc.status}): ${proc.stderr}`);
  }
  const counts = new Map<string, number>();
  const prefix = `${ref}:`;
  const dir = `${posix.dirname(pathspec)}/`;
  for (const line of proc.stdout.split("\n")) {
    if (!line.startsWith(prefix)) continue;
    const m = /^([^:]+):\d+:(.*)$/.exec(line.slice(prefix.length));
    if (!m || !STAMP_LITERAL_RE.test(m[2]!)) continue;
    // git prints the path relative to cwd; keep only files directly in `dir`.
    const at = m[1]!.lastIndexOf(dir);
    const base = at === -1 ? m[1]! : m[1]!.slice(at + dir.length);
    if (base.includes("/")) continue;
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  return counts;
}

/**
 * Relative `./x` / `../x` specifiers in `import … from` / `export … from`
 * statements (multi-line lists included) and side-effect `import "./x"`. The
 * parse is textual: a specifier that names no file on the ref fails loudly in
 * showAt rather than being skipped.
 */
const RELATIVE_FROM_RE = /\b(?:import|export)\b[^;]*?\bfrom\s*["'](\.\.?\/[^"']+)["']|\bimport\s*["'](\.\.?\/[^"']+)["']/g;

function tryShowAt(repoRoot: string, ref: string, dir: string, file: string): Buffer | null {
  const proc = spawnSync("git", ["-C", repoRoot, "show", `${ref}:${dir}/${file}`], { maxBuffer: 64 * 1024 * 1024 });
  return proc.status === 0 ? proc.stdout : null;
}

function showAt(repoRoot: string, ref: string, dir: string, file: string): Buffer {
  const bytes = tryShowAt(repoRoot, ref, dir, file);
  if (bytes === null) throw new Error(`git show ${ref}:${dir}/${file} failed: no such file on ${ref}`);
  return bytes;
}

/**
 * Sorted paths relative to `dir` (basenames for top-level modules, with `.ts`)
 * reachable from `roots` through relative imports and re-exports, read from
 * `git show <ref>:<dir>/<file>`, to a fixed point. Specifiers resolving outside
 * `dir` are not followed; a directory specifier resolves to its `index.ts`.
 */
export function relativeImportClosure(repoRoot: string, ref: string, dir: string, roots: string[]): string[] {
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const src = showAt(repoRoot, ref, dir, file).toString("utf-8");
    for (const m of src.matchAll(RELATIVE_FROM_RE)) {
      const target = posix.normalize(posix.join(posix.dirname(file), (m[1] ?? m[2])!.replace(/\.(?:ts|js)$/, "")));
      if (target.startsWith("..")) continue;
      const asFile = `${target}.ts`;
      const dep = seen.has(asFile) || tryShowAt(repoRoot, ref, dir, asFile) !== null ? asFile : `${target}/index.ts`;
      if (!seen.has(dep)) queue.push(dep);
    }
  }
  return [...seen].sort();
}

/** Writes the closure of `roots` on `ref` into `outDir`, byte-identical; returns the copied set. */
export function materializeClosure(repoRoot: string, ref: string, dir: string, roots: string[], outDir: string): string[] {
  const files = relativeImportClosure(repoRoot, ref, dir, roots);
  for (const f of files) {
    mkdirSync(dirname(join(outDir, f)), { recursive: true });
    writeFileSync(join(outDir, f), showAt(repoRoot, ref, dir, f));
  }
  return files;
}

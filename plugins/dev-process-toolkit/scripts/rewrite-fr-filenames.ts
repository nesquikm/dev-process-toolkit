#!/usr/bin/env bun
// M18 STE-61 one-shot rewrite — move every `specs/frs/**/fr_<ULID>.md` to its
// new convention-compliant name via `git mv`.
//
// Rules (same as Provider.filenameFor):
//   - Tracker-bound FR (`frontmatter.tracker.<key>` non-null string) →
//     `<tracker-id>.md`. The first tracker key encountered in iteration
//     order wins; multi-tracker FRs pick the primary tracker's ID.
//   - Otherwise → `<short-ULID>.md` where `<short-ULID>` is
//     `spec.frontmatter.id.slice(23, 29)` (matches M16's AC-prefix rule).
//
// Pre-commit sanity: every FR has a resolvable new name (no nulls, no
// collisions). Aborts loudly on any error.
//
// Self-referencing cross-links inside the file content (rare) are rewritten
// in place and staged alongside the rename.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { parseFrontmatter } from "../adapters/_shared/src/frontmatter";

const repoRoot = join(import.meta.dir, "..", "..", "..");
const specsDir = join(repoRoot, "specs");

interface Rename {
  oldPath: string;
  newPath: string;
  oldBase: string;
  newBase: string;
  ulid: string;
}

function git(args: string[]): { stdout: string; stderr: string; code: number } {
  const r = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", code: r.status ?? -1 };
}

function filenameFor(fm: Record<string, unknown>): string {
  const tracker = fm["tracker"];
  if (tracker && typeof tracker === "object" && !Array.isArray(tracker)) {
    for (const [key, value] of Object.entries(tracker as Record<string, unknown>)) {
      if (typeof value === "string" && value.length > 0) {
        return `${value}.md`;
      }
    }
  }
  const id = fm["id"];
  if (typeof id !== "string") {
    throw new TypeError(`filenameFor: spec.id missing (fm=${JSON.stringify(fm)})`);
  }
  return `${id.slice(23, 29)}.md`;
}

function collectFRs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isFile()) continue;
    if (!entry.endsWith(".md")) continue;
    if (!/^fr_[0-9A-HJKMNP-TV-Z]{26}\.md$/.test(entry)) continue;
    out.push(full);
  }
  return out;
}

function plan(): Rename[] {
  const activeDir = join(specsDir, "frs");
  const archiveDir = join(specsDir, "frs", "archive");
  const files = [...collectFRs(activeDir), ...collectFRs(archiveDir)];
  const renames: Rename[] = [];
  const newBasesPerDir = new Map<string, Set<string>>();
  for (const oldPath of files) {
    const text = readFileSync(oldPath, "utf8");
    const fm = parseFrontmatter(text);
    const ulid = String(fm["id"] ?? "");
    if (!ulid) throw new Error(`Missing id in ${oldPath}`);
    const newBase = filenameFor(fm);
    const dir = oldPath.substring(0, oldPath.lastIndexOf("/"));
    const newPath = join(dir, newBase);
    const oldBase = basename(oldPath);
    if (newBase === oldBase) continue;
    const bucket = newBasesPerDir.get(dir) ?? new Set();
    if (bucket.has(newBase)) {
      throw new Error(`Collision: two FRs would both land at ${newPath}`);
    }
    bucket.add(newBase);
    newBasesPerDir.set(dir, bucket);
    renames.push({ oldPath, newPath, oldBase, newBase, ulid });
  }
  return renames;
}

function rewriteSelfRefs(renames: Rename[]): string[] {
  const touched: string[] = [];
  // Walk *.md files under specs/ to rewrite `fr_<ULID>.md` references in
  // body content. After Phase A most self-refs are rare, but be safe.
  for (const r of renames) {
    const text = readFileSync(r.newPath, "utf8");
    if (!text.includes(r.oldBase)) continue;
    const next = text.replaceAll(r.oldBase, r.newBase);
    if (next !== text) {
      writeFileSync(r.newPath, next);
      touched.push(r.newPath);
    }
  }
  return touched;
}

function main(): void {
  const renames = plan();
  console.error(`Planned ${renames.length} renames`);
  if (renames.length === 0) {
    console.error("Nothing to do.");
    return;
  }
  // Prefer `git mv` when specs/ is tracked; fall back to filesystem `mv`
  // when specs/ is gitignored (the plugin repo dogfoods with specs/ ignored;
  // downstream projects will track specs/ and use the git-mv path).
  const probe = git(["ls-files", "--error-unmatch", renames[0]!.oldPath]);
  const useGitMv = probe.code === 0;
  for (const r of renames) {
    if (useGitMv) {
      const res = git(["mv", r.oldPath, r.newPath]);
      if (res.code !== 0) {
        throw new Error(`git mv failed for ${r.oldPath} -> ${r.newPath}: ${res.stderr}`);
      }
    } else {
      renameSync(r.oldPath, r.newPath);
    }
  }
  const touched = rewriteSelfRefs(renames);
  if (touched.length > 0) {
    console.error(`Rewrote self-refs in ${touched.length} file(s)`);
    if (useGitMv) {
      const add = git(["add", ...touched]);
      if (add.code !== 0) throw new Error(`git add failed: ${add.stderr}`);
    } else {
      console.error("  (fs-mv path — self-ref rewrites are on disk only; stage manually if specs/ is tracked downstream.)");
    }
  }
  console.error(`Done (${useGitMv ? "git mv" : "fs mv"}). Review state then commit.`);
}

main();

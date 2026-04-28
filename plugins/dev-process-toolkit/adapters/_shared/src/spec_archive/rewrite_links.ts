// rewrite_links — STE-111 AC-STE-111.1 / .2 / .6 helper.
//
// /spec-archive calls this between `git mv` and the commit. It scans:
//   - specs/requirements.md
//   - specs/plan/*.md (active milestone plans)
//   - specs/plan/archive/*.md (archived milestone plans)
//   - CHANGELOG.md (scoped to lines above the first `## [X.Y.Z] — YYYY-MM-DD`)
//
// Mechanical string replace `frs/<id>.md` → `frs/archive/<id>.md`. Both
// Markdown link forms (`](frs/<id>.md)` and `](./frs/<id>.md)`) and bare
// path mentions are covered (the literal substring `frs/<id>.md` is the
// match key — bare path mentions, link wrappers, and dotted-relative links
// all share the same suffix).

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface RewriteResult {
  filesChanged: string[];
}

const DATED_RELEASE_HEADER_RE = /^## \[\d+\.\d+\.\d+\]\s*—\s*\d{4}-\d{2}-\d{2}/m;

function listPlans(root: string, archive: boolean): string[] {
  const dir = archive ? join(root, "specs", "plan", "archive") : join(root, "specs", "plan");
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((n) => n.endsWith(".md"))
      .map((n) => join(dir, n));
  } catch {
    return [];
  }
}

function rewriteFile(absPath: string, before: string, after: string): boolean {
  if (!existsSync(absPath)) return false;
  const content = readFileSync(absPath, "utf-8");
  if (!content.includes(before)) return false;
  const next = content.split(before).join(after);
  writeFileSync(absPath, next);
  return true;
}

function rewriteChangelog(absPath: string, before: string, after: string): boolean {
  if (!existsSync(absPath)) return false;
  const content = readFileSync(absPath, "utf-8");
  if (!content.includes(before)) return false;

  // Find the first dated `## [X.Y.Z] — YYYY-MM-DD` header. Scoping the
  // rewrite to lines BEFORE that header preserves the "released sections
  // are immutable" invariant.
  const match = DATED_RELEASE_HEADER_RE.exec(content);
  let scopeEnd = match ? match.index : content.length;

  // Be defensive: only rewrite if there's at least one occurrence in the
  // unreleased prefix.
  const prefix = content.slice(0, scopeEnd);
  if (!prefix.includes(before)) return false;

  const rewrittenPrefix = prefix.split(before).join(after);
  const next = rewrittenPrefix + content.slice(scopeEnd);
  writeFileSync(absPath, next);
  return true;
}

export function rewriteArchiveLinks(repoRoot: string, frId: string): RewriteResult {
  const before = `frs/${frId}.md`;
  const after = `frs/archive/${frId}.md`;
  const filesChanged: string[] = [];

  const requirements = join(repoRoot, "specs", "requirements.md");
  if (rewriteFile(requirements, before, after)) {
    filesChanged.push("specs/requirements.md");
  }

  for (const planPath of listPlans(repoRoot, /* archive */ false)) {
    if (rewriteFile(planPath, before, after)) {
      filesChanged.push(planPath.slice(repoRoot.length + 1));
    }
  }
  for (const planPath of listPlans(repoRoot, /* archive */ true)) {
    if (rewriteFile(planPath, before, after)) {
      filesChanged.push(planPath.slice(repoRoot.length + 1));
    }
  }

  const changelog = join(repoRoot, "CHANGELOG.md");
  if (rewriteChangelog(changelog, before, after)) {
    filesChanged.push("CHANGELOG.md");
  }

  return { filesChanged };
}

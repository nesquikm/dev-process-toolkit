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
import { dirname, join, relative, resolve } from "node:path";

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

// STE-736 AC-STE-736.1: an archived plan sits one folder deeper than an active
// one, so its relative FR links need one more `../`. Each relative Markdown
// link target naming this FR that does not resolve from the plan's own folder
// is recomputed to point at the archived FR file; a target that resolves today
// is left alone. Bare (non-link) mentions keep the plain string replace.
// AC-STE-736.2: the same repair covers any OTHER FR link in the plan that is
// already broken (the v3.3.0 shape `../frs/archive/<id>.md` written before the
// plan moved), pointed at whichever FR file exists today.
const LINK_TARGET_RE = /\]\(([^)\s]+)\)/g;
const ANY_FR_TARGET_RE = /(?:^|\/)frs\/(?:archive\/)?([^/]+)\.md$/;

/** A POSIX-separated link from `fromDir` to `toPath`, as Markdown wants it. */
function linkFrom(fromDir: string, toPath: string): string {
  return relative(fromDir, toPath).split("\\").join("/");
}

function archivedFrPath(repoRoot: string, id: string): string {
  return join(repoRoot, "specs", "frs", "archive", `${id}.md`);
}

/** Split a link target into its path and its `?query` / `#fragment` suffix. */
function splitSuffix(target: string): [string, string] {
  const i = target.search(/[?#]/);
  return i < 0 ? [target, ""] : [target.slice(0, i), target.slice(i)];
}

function repairedTarget(planDir: string, repoRoot: string, target: string): string | null {
  const [path, suffix] = splitSuffix(target);
  const m = ANY_FR_TARGET_RE.exec(path);
  if (!m) return null;
  for (const candidate of [archivedFrPath(repoRoot, m[1]!), join(repoRoot, "specs", "frs", `${m[1]}.md`)]) {
    if (existsSync(candidate)) return linkFrom(planDir, candidate) + suffix;
  }
  return null;
}

// Call-site contract: the caller must move the FR (and the plan) into its
// archive folder BEFORE calling. A link that still resolves is left alone, so a
// rewrite run before the `git mv` leaves the plan's FR links unrewritten.
function rewriteArchivedPlan(absPath: string, repoRoot: string, frId: string, before: string, after: string): boolean {
  if (!existsSync(absPath)) return false;
  const content = readFileSync(absPath, "utf-8");
  const planDir = dirname(absPath);
  const archivedFr = archivedFrPath(repoRoot, frId);
  const targetRe = new RegExp(`(^|/)frs/(archive/)?${frId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.md$`);
  let next = "";
  let last = 0;
  for (const m of content.matchAll(LINK_TARGET_RE)) {
    const target = m[1]!;
    const start = m.index! + 2;
    next += content.slice(last, start).split(before).join(after);
    last = start + target.length;
    const [targetPath, suffix] = splitSuffix(target);
    const relativeLink = !/^[a-z]+:/i.test(target) && !target.startsWith("/");
    if (!relativeLink || targetPath === "" || existsSync(resolve(planDir, targetPath))) {
      next += target;
    } else if (targetRe.test(targetPath)) {
      next += linkFrom(planDir, archivedFr) + suffix;
    } else {
      next += repairedTarget(planDir, repoRoot, target) ?? target;
    }
  }
  next += content.slice(last).split(before).join(after);
  if (next === content) return false;
  writeFileSync(absPath, next);
  return true;
}

/**
 * STE-736 AC-STE-736.1 (plan-only archival): after a plan's `git mv` into
 * specs/plan/archive/ with no FR archived in the run, repair every relative FR
 * link in the moved plan that no longer resolves from its new folder. Links
 * that resolve today are left byte-for-byte alone. `planPath` is relative to
 * `repoRoot`.
 */
export function repairArchivedPlanLinks(repoRoot: string, planPath: string): RewriteResult {
  const abs = join(repoRoot, planPath);
  if (!existsSync(abs)) return { filesChanged: [] };
  const content = readFileSync(abs, "utf-8");
  const dir = dirname(abs);
  const next = content.replace(LINK_TARGET_RE, (whole, t: string) => {
    const p = splitSuffix(t)[0];
    if (/^[a-z]+:/i.test(t) || t.startsWith("/") || p === "" || existsSync(resolve(dir, p))) return whole;
    const fixed = repairedTarget(dir, repoRoot, t);
    return fixed === null ? whole : `](${fixed})`;
  });
  if (next === content) return { filesChanged: [] };
  writeFileSync(abs, next);
  return { filesChanged: [planPath] };
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

// Call-site contract: move each FR and the plan into their archive folders
// (`git mv`) BEFORE calling this. Archived-plan links that still resolve are
// left alone, so calling it first leaves those links pointing at moved files.
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
    if (rewriteArchivedPlan(planPath, repoRoot, frId, before, after)) {
      filesChanged.push(planPath.slice(repoRoot.length + 1));
    }
  }

  const changelog = join(repoRoot, "CHANGELOG.md");
  if (rewriteChangelog(changelog, before, after)) {
    filesChanged.push("CHANGELOG.md");
  }

  return { filesChanged };
}

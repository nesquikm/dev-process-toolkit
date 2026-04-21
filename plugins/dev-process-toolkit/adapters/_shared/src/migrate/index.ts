// migrate/index.ts — orchestrator for v1 → v2 layout migration (FR-48).
//
// Invariants:
//   - Clean working tree required (AC-48.3)
//   - Backup tag created before any mutation (AC-48.5)
//   - All writes staged in memory first, committed in a single git pass
//     (AC-48.10), then layout marker committed separately (AC-48.11)
//   - Dry-run writes into specs/.migration-preview/ only (AC-48.4)
//   - Idempotent: re-run on a v2 tree returns `already-v2` (AC-48.13)

import { $ } from "bun";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { regenerateIndex } from "../index_gen";
import { mintId } from "../ulid";
import { colocate } from "./colocate";
import { convertArchiveFile, renderArchivedFrFile } from "./convert_archive";
import { renderArchivedPlanFile, renderPlanFile, splitPlan } from "./split_plan";
import { splitFrs } from "./split_fr";

export interface MigrateOptions {
  repoRoot: string;
  mode: "live" | "dry-run";
  now?: string;
  userEmail?: string;
}

export interface MigrateSummary {
  frsMigrated: number;
  milestonesSplit: number;
  archivedItemsConverted: number;
  residualTechBytes: number;
  residualTestingBytes: number;
}

export type MigrateResult =
  | { kind: "already-v2"; message: string }
  | { kind: "dry-run"; previewDir: string; summary: MigrateSummary }
  | { kind: "migrated"; tag: string; summary: MigrateSummary };

interface StagedFile {
  relPath: string;
  content: string;
}

function formatTagTimestamp(now: string): string {
  // YYYYMMDD-HHMMSS
  const iso = new Date(now).toISOString();
  return iso.replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
}

async function isCleanTree(repoRoot: string): Promise<{ clean: boolean; uncommitted: string }> {
  const out = (await $`git status --porcelain`.cwd(repoRoot).text()).trim();
  return { clean: out.length === 0, uncommitted: out };
}

async function isSpecsTracked(repoRoot: string): Promise<boolean> {
  const proc = Bun.spawnSync({
    cmd: ["git", "ls-files", "--error-unmatch", "specs/requirements.md"],
    cwd: repoRoot,
  });
  return proc.exitCode === 0;
}

function readTextIfExists(path: string): string | null {
  if (!existsSync(path)) return null;
  return readFileSync(path, "utf-8");
}

function listArchiveFiles(specsDir: string): string[] {
  const archiveDir = join(specsDir, "archive");
  if (!existsSync(archiveDir)) return [];
  return readdirSync(archiveDir)
    .filter((f) => f.endsWith(".md") && f !== "index.md")
    .sort();
}

function renderFrFile(params: {
  id: string;
  title: string;
  milestone: string;
  createdAt: string;
  requirementBody: string;
  acceptanceCriteria: string[];
  technicalDesign: string;
  testing: string;
}): string {
  const lines = [
    "---",
    `id: ${params.id}`,
    `title: ${params.title}`,
    `milestone: ${params.milestone}`,
    `status: active`,
    `archived_at: null`,
    `tracker: {}`,
    `created_at: ${params.createdAt}`,
    "---",
    "",
    "## Requirement",
    "",
    params.requirementBody,
    "",
    "## Acceptance Criteria",
    "",
    params.acceptanceCriteria.length > 0
      ? params.acceptanceCriteria.join("\n")
      : "*(no acceptance criteria recorded during migration)*",
    "",
    "## Technical Design",
    "",
    params.technicalDesign.length > 0 ? params.technicalDesign : "*(not present in v1; fill in post-migration)*",
    "",
    "## Testing",
    "",
    params.testing.length > 0 ? params.testing : "*(not present in v1; fill in post-migration)*",
    "",
    "## Notes",
    "",
    `Migrated from v1 by \`/setup --migrate\` on ${params.createdAt.slice(0, 10)}.`,
    "",
  ];
  return lines.join("\n");
}

function cleanRequirementBody(body: string): string {
  // Drop the **Acceptance Criteria:** trailing block since we extract it separately
  return body.replace(/\n?\*\*Acceptance Criteria:\*\*[\s\S]*$/m, "").trim();
}

async function writeFiles(baseDir: string, files: StagedFile[]): Promise<void> {
  for (const f of files) {
    const full = join(baseDir, f.relPath);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, f.content);
  }
}

export async function migrate(options: MigrateOptions): Promise<MigrateResult> {
  const { repoRoot, mode } = options;
  const now = options.now ?? new Date().toISOString();
  const specsDir = join(repoRoot, "specs");
  const layoutPath = join(specsDir, ".dpt-layout");
  const requirementsPath = join(specsDir, "requirements.md");

  // 1. Detect (AC-48.1, AC-48.13)
  if (existsSync(layoutPath)) {
    return {
      kind: "already-v2",
      message: `Already on v2 layout. Nothing to do.`,
    };
  }
  if (!existsSync(requirementsPath)) {
    return {
      kind: "already-v2",
      message: `No specs/requirements.md found; nothing to migrate.`,
    };
  }

  // 3. Clean-tree precondition (AC-48.3) — checked for live mode
  if (mode === "live") {
    const { clean, uncommitted } = await isCleanTree(repoRoot);
    if (!clean) {
      throw new Error(
        `Migration requires a clean working tree. Uncommitted files:\n${uncommitted}`,
      );
    }
  }

  // 5. Parse sources (read-only, in memory)
  const reqText = readFileSync(requirementsPath, "utf-8");
  const techText = readTextIfExists(join(specsDir, "technical-spec.md")) ?? "";
  const testingText = readTextIfExists(join(specsDir, "testing-spec.md")) ?? "";
  const planText = readTextIfExists(join(specsDir, "plan.md")) ?? "";
  const archiveFiles = listArchiveFiles(specsDir);

  const activeBlocks = splitFrs(reqText);
  const colocated = colocate(techText, testingText);
  const planSplit = splitPlan(planText);

  // First: parse each archive file to get its FRs. Archive wins over live
  // requirements for any duplicated FR id — this resolves the "live
  // requirements.md still holds an FR whose milestone was archived" drift.
  interface ArchivedEntry {
    sourceFile: string;
    milestone: string;
    archivedAt: string;
    oldId: string;
    title: string;
    body: string;
    acceptanceCriteria: string[];
    newId: string;
  }
  const archivedEntries: ArchivedEntry[] = [];
  const archivedIdSet = new Set<string>();
  for (const file of archiveFiles) {
    const text = readFileSync(join(specsDir, "archive", file), "utf-8");
    const parsed = convertArchiveFile(text);
    for (const fr of parsed.frs) {
      archivedIdSet.add(fr.oldId);
      archivedEntries.push({
        sourceFile: `specs/archive/${file}`,
        milestone: parsed.milestone,
        archivedAt: parsed.archivedAt,
        oldId: fr.oldId,
        title: fr.title,
        body: fr.body,
        acceptanceCriteria: fr.acceptanceCriteria,
        newId: "", // minted after dedup in the active-first pass
      });
    }
  }

  // 6. Mint ULIDs — active FRs first (skipping duplicates already in archive),
  // then archived FRs. Stable order by FR id keeps DPT_TEST_ULID_SEED output
  // deterministic for fixture tests.
  const activeIds = [...activeBlocks.keys()]
    .filter((id) => !archivedIdSet.has(id))
    .sort((a, b) => oldFrOrder(a, b));
  const activeIdMap = new Map<string, string>();
  for (const oldId of activeIds) {
    activeIdMap.set(oldId, mintId());
  }
  // Now mint ULIDs for archived entries in their insertion order
  for (const e of archivedEntries) {
    e.newId = mintId();
  }

  // 7. Stage new tree in memory
  const staged: StagedFile[] = [];

  for (const oldId of activeIds) {
    const block = activeBlocks.get(oldId)!;
    const newId = activeIdMap.get(oldId)!;
    // Derive milestone: look through planSplit for the milestone that references this FR
    // in its body. If no match, fall back to the first in-flight milestone.
    const milestone = findMilestoneForFr(oldId, planSplit) ?? fallbackMilestone(planSplit);
    staged.push({
      relPath: `specs/frs/${newId}.md`,
      content: renderFrFile({
        id: newId,
        title: block.title,
        milestone,
        createdAt: now,
        requirementBody: cleanRequirementBody(block.body),
        acceptanceCriteria: block.acceptanceCriteria,
        technicalDesign: colocated.perFrTech.get(oldId) ?? "",
        testing: colocated.perFrTesting.get(oldId) ?? "",
      }),
    });
  }

  for (const e of archivedEntries) {
    staged.push({
      relPath: `specs/frs/archive/${e.newId}.md`,
      content: renderArchivedFrFile({
        newId: e.newId,
        oldId: e.oldId,
        title: e.title,
        milestone: e.milestone,
        archivedAt: e.archivedAt,
        createdAt: now,
        body: e.body,
        acceptanceCriteria: e.acceptanceCriteria,
        sourceFile: e.sourceFile,
      }),
    });
  }

  for (const m of planSplit.milestones) {
    staged.push({
      relPath: `specs/plan/${m.id}.md`,
      content: renderPlanFile(m),
    });
  }

  // Archived milestones go under specs/plan/archive/
  for (const p of planSplit.archivedPointers) {
    const sourceArchive = readTextIfExists(join(repoRoot, p.archiveFile));
    const body = extractArchivedPlanBody(sourceArchive ?? "");
    staged.push({
      relPath: `specs/plan/archive/${p.id}.md`,
      content: renderArchivedPlanFile(p, body),
    });
  }

  // Slimmed cross-cutting specs
  const slimmedReq = slimRequirements(reqText);
  staged.push({ relPath: `specs/requirements.md`, content: slimmedReq });
  staged.push({
    relPath: `specs/technical-spec.md`,
    content: colocated.residualTech.length > 0 ? colocated.residualTech : "",
  });
  staged.push({
    relPath: `specs/testing-spec.md`,
    content: colocated.residualTesting.length > 0 ? colocated.residualTesting : "",
  });

  const summary: MigrateSummary = {
    frsMigrated: activeIds.length,
    milestonesSplit: planSplit.milestones.length,
    archivedItemsConverted: archivedEntries.length,
    residualTechBytes: colocated.residualTech.length,
    residualTestingBytes: colocated.residualTesting.length,
  };

  // 8. Write (dry-run or live)
  if (mode === "dry-run") {
    const previewDir = join(specsDir, ".migration-preview");
    // Clean previous preview if any
    if (existsSync(previewDir)) rmSync(previewDir, { recursive: true, force: true });
    mkdirSync(previewDir, { recursive: true });
    // Rewrite staged paths so specs/* becomes <previewDir>/*
    const previewStaged = staged.map((s) => ({
      relPath: s.relPath.replace(/^specs\//, ""),
      content: s.content,
    }));
    await writeFiles(previewDir, previewStaged);
    return { kind: "dry-run", previewDir, summary };
  }

  // Detect whether specs/ is git-tracked. Some repos (like DPT's own) keep
  // specs/ in .gitignore and maintain it locally without commits. In that
  // case we still produce the v2 tree on disk, skip git ops, and return
  // the migrated kind with a null tag + "untracked" message.
  const specsIsTracked = await isSpecsTracked(repoRoot);

  if (!specsIsTracked) {
    // Filesystem-only migration: delete old files, write new tree, regen INDEX.
    const toRemoveFs: string[] = [];
    for (const f of ["requirements.md", "technical-spec.md", "testing-spec.md", "plan.md"]) {
      if (existsSync(join(specsDir, f))) toRemoveFs.push(join(specsDir, f));
    }
    const oldArchiveDir = join(specsDir, "archive");
    if (existsSync(oldArchiveDir)) {
      for (const f of readdirSync(oldArchiveDir)) {
        toRemoveFs.push(join(oldArchiveDir, f));
      }
      toRemoveFs.push(oldArchiveDir);
    }
    for (const full of toRemoveFs) {
      try {
        rmSync(full, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
    await writeFiles(repoRoot, staged);
    await regenerateIndex(specsDir, { now });
    const marker = [`version: v2`, `migrated_at: ${now}`, `migration_commit: null`, ""].join("\n");
    writeFileSync(layoutPath, marker);
    return { kind: "migrated", tag: "untracked-specs-no-tag", summary };
  }

  // Live tracked path: backup tag + two-commit sequence.
  const tag = `dpt-v1-snapshot-${formatTagTimestamp(now)}`;
  await $`git tag ${tag}`.cwd(repoRoot).quiet();

  const toRemove: string[] = [];
  for (const f of ["requirements.md", "technical-spec.md", "testing-spec.md", "plan.md"]) {
    if (existsSync(join(specsDir, f))) toRemove.push(join("specs", f));
  }
  const oldArchiveDir = join(specsDir, "archive");
  if (existsSync(oldArchiveDir)) {
    for (const f of readdirSync(oldArchiveDir)) {
      toRemove.push(join("specs", "archive", f));
    }
  }
  for (const rel of toRemove) {
    await $`git rm -q ${rel}`.cwd(repoRoot).quiet();
  }

  await writeFiles(repoRoot, staged);
  await regenerateIndex(specsDir, { now });

  await $`git add specs/`.cwd(repoRoot).quiet();
  await $`git commit -q -m "feat(specs): migrate to v2 layout"`.cwd(repoRoot).quiet();

  const marker = [`version: v2`, `migrated_at: ${now}`, `migration_commit: null`, ""].join("\n");
  writeFileSync(layoutPath, marker);
  await $`git add ${layoutPath}`.cwd(repoRoot).quiet();
  await $`git commit -q -m "chore(specs): record v2 layout marker"`.cwd(repoRoot).quiet();

  return { kind: "migrated", tag, summary };
}

function oldFrOrder(a: string, b: string): number {
  const na = parseInt(a.replace(/^FR-/, ""), 10);
  const nb = parseInt(b.replace(/^FR-/, ""), 10);
  return na - nb;
}

/**
 * Resolve an FR's milestone by scanning plan bodies.
 *
 * Strategy (in order):
 *   1. Look for the canonical declaration line `**FRs covered:** FR-N..M`
 *      (or comma-separated variants like `FR-N, FR-M, FR-P`) in each
 *      milestone body. This is the unambiguous author-declared mapping.
 *   2. If no milestone has the canonical line, fall back to a substring
 *      match — but only on the first `- [ ]` task-line occurrence (task
 *      lines reference the FR they're implementing), not the whole body.
 *      This avoids the old bug where cross-milestone commentary caused
 *      mis-attribution (e.g., M12's body mentioned FR-41..50 in its
 *      co-development paragraph, so the substring match incorrectly
 *      bucketed M13's FRs into M12).
 *
 * Returns null if no milestone claims the FR; caller falls back to
 * fallbackMilestone.
 */
function findMilestoneForFr(oldId: string, planSplit: ReturnType<typeof splitPlan>): string | null {
  // Pass 1: canonical `**FRs covered:**` declaration
  const n = parseInt(oldId.replace(/^FR-/, ""), 10);
  if (!Number.isNaN(n)) {
    for (const m of planSplit.milestones) {
      const declared = extractDeclaredFrRange(m.body);
      if (declared.has(n)) return m.id;
    }
  }
  // Pass 2: scoped-body substring (task-line only, not commentary)
  const targetRe = new RegExp(`^\\s*-\\s+\\[\\s*[ x]\\s*\\]\\s.*\\b${oldId}\\b`, "m");
  for (const m of planSplit.milestones) {
    if (targetRe.test(m.body)) return m.id;
  }
  return null;
}

/**
 * Parse `**FRs covered:** FR-29..39` or `**FRs covered:** FR-1, FR-2, FR-5`
 * into a Set of FR numbers. Used by findMilestoneForFr to make milestone
 * attribution unambiguous.
 */
function extractDeclaredFrRange(planBody: string): Set<number> {
  const out = new Set<number>();
  const m = /\*\*FRs covered:\*\*\s*([^\n]+)/i.exec(planBody);
  if (!m) return out;
  const list = m[1]!;
  // Match ranges like FR-29..39 and individual FR-N
  const rangeRe = /FR-(\d+)\.\.(\d+)/g;
  const singleRe = /FR-(\d+)(?!\.\.\d)/g;
  let match: RegExpExecArray | null;
  const consumed = new Set<string>();
  while ((match = rangeRe.exec(list)) !== null) {
    const a = parseInt(match[1]!, 10);
    const b = parseInt(match[2]!, 10);
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    for (let i = lo; i <= hi; i++) {
      out.add(i);
      consumed.add(`FR-${i}`);
    }
  }
  while ((match = singleRe.exec(list)) !== null) {
    out.add(parseInt(match[1]!, 10));
  }
  return out;
}

function fallbackMilestone(planSplit: ReturnType<typeof splitPlan>): string {
  if (planSplit.milestones.length > 0) return planSplit.milestones[0]!.id;
  return "M0";
}

function extractArchivedPlanBody(archiveFileContent: string): string {
  // Pull the plan block from a v1 Schema G archive file
  const m = /## Plan block[^\n]*\n\n([\s\S]*?)\n\n## /.exec(archiveFileContent);
  if (!m) return "";
  const innerBlock = m[1]!;
  // Drop the leading ### M<N>: heading since our renderer adds its own # heading
  return innerBlock.replace(/^###\s+M\d+:.*\n\n?/, "").trim();
}

function slimRequirements(reqText: string): string {
  // Drop ## 2. Functional Requirements section (FR blocks) and preserve everything else.
  const lines = reqText.split("\n");
  const out: string[] = [];
  let skipping = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^##\s+\d+\.\s+Functional Requirements/.test(line)) {
      skipping = true;
      continue;
    }
    if (skipping && /^##\s+/.test(line) && !/^##\s+\d+\.\s+Functional Requirements/.test(line)) {
      skipping = false;
    }
    if (skipping) continue;
    out.push(line);
  }
  // Also: the traceability matrix in §6 should have per-FR rows replaced with a
  // pointer row. Find the table body (consecutive `| ... |` rows) and replace
  // them wholesale with the pointer row.
  let joined = out.join("\n");
  joined = joined.replace(
    /(\|\s*Requirement\s*\|\s*Implementation\s*\|\s*Tests\s*\|\s*\n\|[^\n]+\|\n)((?:\|[^\n]*\|\n)+)/m,
    (_match, headerBlock: string) => {
      return `${headerBlock}| *(see individual FR files under specs/frs/ for per-FR traceability)* | | |\n`;
    },
  );
  // Collapse 3+ blank lines to 2
  joined = joined.replace(/\n{3,}/g, "\n\n");
  if (!joined.endsWith("\n")) joined += "\n";
  return joined;
}

// traceability_link_validity — /gate-check probe (STE-111 AC-STE-111.4).
//
// Every `frs/<id>.md` reference in `specs/requirements.md` and any
// `specs/plan/<M>.md` (active milestone plan) MUST resolve to an existing
// file under `specs/frs/<id>.md` OR `specs/frs/archive/<id>.md`.
// Catches broken-link drift that /spec-archive's rewrite step is meant
// to prevent.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

// Match `frs/<id>.md` anywhere — covers `[text](frs/X.md)`, `[text](./frs/X.md)`,
// bare `frs/X.md` mentions, and `frs/archive/X.md` (allow form, then verified).
const FRS_REF_RE = /\b(?:\.\/)?frs(?:\/archive)?\/([A-Za-z0-9_-]+)\.md\b/g;

export interface TraceabilityLinkViolation {
  file: string;
  line: number;
  reason: string;
  note: string;
  message: string;
}

export interface TraceabilityLinkReport {
  violations: TraceabilityLinkViolation[];
}

function listActivePlans(root: string): string[] {
  const dir = join(root, "specs", "plan");
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir)
      .filter((n) => n.endsWith(".md"))
      .map((n) => join(dir, n));
  } catch {
    return [];
  }
}

function buildMessage(reason: string, file: string, frId: string): string {
  return [
    `traceability_link_validity: ${reason}`,
    `Remedy: rewrite the link in ${file} to point at the FR file's actual location ` +
      `(specs/frs/${frId}.md OR specs/frs/archive/${frId}.md). ` +
      `If the FR was archived after this link was written, run /spec-archive's rewrite step manually ` +
      `(plugins/dev-process-toolkit/adapters/_shared/src/spec_archive/rewrite_links.ts:rewriteArchiveLinks).`,
    `Context: file=${file}, fr=${frId}, probe=traceability_link_validity`,
  ].join("\n");
}

function scanFile(absPath: string, projectRoot: string): TraceabilityLinkViolation[] {
  if (!existsSync(absPath)) return [];
  let content: string;
  try {
    content = readFileSync(absPath, "utf-8");
  } catch {
    return [];
  }
  const violations: TraceabilityLinkViolation[] = [];
  const lines = content.split("\n");
  const rel = relative(projectRoot, absPath);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    FRS_REF_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = FRS_REF_RE.exec(line)) !== null) {
      const fullMatch = match[0]!;
      const frId = match[1]!;
      // Determine which path was claimed: live or archive.
      const claimedArchive = /\bfrs\/archive\//.test(fullMatch);
      const livePath = join(projectRoot, "specs", "frs", `${frId}.md`);
      const archivePath = join(projectRoot, "specs", "frs", "archive", `${frId}.md`);
      const liveExists = existsSync(livePath);
      const archiveExists = existsSync(archivePath);
      const targetPath = claimedArchive ? archivePath : livePath;
      if (!existsSync(targetPath)) {
        // Broken: claimed path doesn't exist. Suggest the alternative if it does.
        const reason = claimedArchive
          ? `${fullMatch} → ${archivePath} does not exist (live exists: ${liveExists ? "yes" : "no"})`
          : `${fullMatch} → ${livePath} does not exist (archive exists: ${archiveExists ? "yes" : "no"})`;
        violations.push({
          file: absPath,
          line: i + 1,
          reason,
          note: `${rel}:${i + 1} — ${reason}`,
          message: buildMessage(reason, rel, frId),
        });
      }
    }
  }
  return violations;
}

export async function runTraceabilityLinkValidityProbe(
  projectRoot: string,
): Promise<TraceabilityLinkReport> {
  const specsDir = join(projectRoot, "specs");
  if (!existsSync(specsDir)) return { violations: [] };

  const violations: TraceabilityLinkViolation[] = [];
  const requirements = join(specsDir, "requirements.md");
  violations.push(...scanFile(requirements, projectRoot));
  for (const planPath of listActivePlans(projectRoot)) {
    violations.push(...scanFile(planPath, projectRoot));
  }
  return { violations };
}

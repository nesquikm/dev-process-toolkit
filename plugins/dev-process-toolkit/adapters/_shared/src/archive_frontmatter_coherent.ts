// archive_frontmatter_coherent — STE-210 AC-STE-210.4 /gate-check probe.
//
// Invariant: every file under `specs/frs/archive/` and
// `specs/plan/archive/` MUST have frontmatter `status: archived` and
// `archived_at:` populated (non-null ISO-8601 string). The probe is the
// regression signal for the F11 staging-order bug — an archive commit
// landed with `status: active` because frontmatter was edited before
// `git mv` (the bug shape STE-210 AC-STE-210.2 fixes).
//
// Severity: ERROR. A file in `archive/` with `status: active` is a
// shipped-to-history regression that needs explicit operator action.
// Existing legacy archives that pre-date this probe pass cleanly because
// past archival flows wrote the correct frontmatter (the bug is a
// recent regression — fix-forward without retroactive cleanup).
//
// Sibling to `archive_plan_status` probe (#16): that one walks ONLY
// plan archives; this probe walks BOTH FR and plan archives. The two
// probes overlap on the plan-archive arm but the plan-archive
// arm of #16 is older (M22) and uses different message text — keeping
// both runs is intentional defense-in-depth.

import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { parseFrontmatter } from "./frontmatter";

export interface ArchiveFrontmatterCoherentViolation {
  file: string;
  line: number;
  reason: string;
  note: string;
}

export interface ArchiveFrontmatterCoherentReport {
  violations: ArchiveFrontmatterCoherentViolation[];
}

async function listArchiveFiles(projectRoot: string): Promise<string[]> {
  const out: string[] = [];
  for (const subdir of [
    join("specs", "frs", "archive"),
    join("specs", "plan", "archive"),
  ]) {
    const dir = join(projectRoot, subdir);
    try {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isFile() && e.name.endsWith(".md")) {
          out.push(join(dir, e.name));
        }
      }
    } catch {
      // missing dir is fine (fresh repos)
    }
  }
  return out.sort();
}

export async function runArchiveFrontmatterCoherentProbe(
  projectRoot: string,
): Promise<ArchiveFrontmatterCoherentReport> {
  const files = await listArchiveFiles(projectRoot);
  const violations: ArchiveFrontmatterCoherentViolation[] = [];

  for (const file of files) {
    let content: string;
    try {
      content = await readFile(file, "utf-8");
    } catch {
      continue;
    }
    let fm: Record<string, unknown> = {};
    try {
      fm = parseFrontmatter(content);
    } catch {
      const rel = relative(projectRoot, file);
      const reason = `archived file lacks parseable YAML frontmatter`;
      violations.push({
        file,
        line: 1,
        reason,
        note: `${rel}:1 — ${reason}`,
      });
      continue;
    }
    const status = fm["status"];
    const archivedAt = fm["archived_at"];
    const rel = relative(projectRoot, file);
    if (status !== "archived") {
      const observed = status === undefined ? "<missing>" : String(status);
      const reason = `archived file frontmatter shows status: ${observed}, expected status: archived (F11 staging-order bug shape)`;
      violations.push({ file, line: 1, reason, note: `${rel}:1 — ${reason}` });
      continue;
    }
    // Bare-key form `archived_at:` (no value after the colon) parses to
    // `{}` via parseFrontmatter; treat it as missing, same posture as
    // archive_plan_status probe #16.
    const isEmptyObject =
      typeof archivedAt === "object" &&
      archivedAt !== null &&
      Object.keys(archivedAt).length === 0;
    if (
      archivedAt === undefined ||
      archivedAt === null ||
      archivedAt === "" ||
      isEmptyObject
    ) {
      const reason = `archived file frontmatter has unset archived_at (must be non-null ISO-8601 string)`;
      violations.push({ file, line: 1, reason, note: `${rel}:1 — ${reason}` });
    }
  }

  return { violations };
}

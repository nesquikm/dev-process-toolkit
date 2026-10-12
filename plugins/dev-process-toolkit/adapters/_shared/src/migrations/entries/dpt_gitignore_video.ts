// M_1e0717 STE-663 AC-STE-663.3 — the toolkit-owned `.dpt/.gitignore` gains
// `.env` (machine-local video keys) and `video/work/` (the disposable video
// build tree) in 2.96.0. A project bootstrapped earlier carries the old body,
// so a key file or a rendered video would land in a commit.
//
// DETECT. `.dpt/.gitignore` exists and lacks either line (compared trimmed,
// in any order, amid any operator lines). An absent file is not this entry's
// state — /setup writes the whole file.
//
// APPLY. Appends only the missing lines and keeps every other byte: no
// reordering, no rewrite of the operator's own lines. A body without a
// trailing newline gets one first so the appended rules stay separate lines.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { relative } from "node:path";
import { dptGitignorePath } from "../../setup/dpt_gitignore";
import type { ApplyResult, DetectResult, MigrationEntry } from "../index";

const VIDEO_IGNORE_LINES = [".env", "video/work/"] as const;

function missingLines(projectRoot: string): { path: string; body: string; missing: string[] } | null {
  const path = dptGitignorePath(projectRoot);
  if (!existsSync(path)) return null;
  let body: string;
  try {
    body = readFileSync(path, "utf-8");
  } catch {
    return null;
  }
  const present = new Set(body.split("\n").map((l) => l.trim()));
  return { path, body, missing: VIDEO_IGNORE_LINES.filter((l) => !present.has(l)) };
}

export const dptGitignoreVideo: MigrationEntry = {
  id: "dpt-gitignore-video",
  introduced_in: "2.96.0",
  title: "`.dpt/.gitignore` ignores `.env` and `video/work/`",
  kind: "script",
  detect(projectRoot: string): DetectResult {
    const m = missingLines(projectRoot);
    if (m === null || m.missing.length === 0) return { applies: false, evidence: [] };
    return {
      applies: true,
      evidence: [`${relative(projectRoot, m.path)} lacks ${m.missing.map((l) => `\`${l}\``).join(", ")}`],
    };
  },
  apply(projectRoot: string): ApplyResult {
    const m = missingLines(projectRoot);
    if (m === null || m.missing.length === 0) {
      return { changed: [], summary: "`.dpt/.gitignore` already ignores `.env` and `video/work/`" };
    }
    const sep = m.body === "" || m.body.endsWith("\n") ? "" : "\n";
    writeFileSync(m.path, `${m.body}${sep}${m.missing.join("\n")}\n`);
    const rel = relative(projectRoot, m.path);
    return { changed: [rel], summary: `appended ${m.missing.join(", ")} to ${rel}` };
  },
};

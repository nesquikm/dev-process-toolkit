// INDEX.md generator (FR-40, AC-40.4/5, NFR-13, §8.7).
//
// Algorithm (technical-spec §8.7):
//   1. glob specs/frs/*.md excluding specs/frs/archive/
//   2. read + parse YAML frontmatter into FRIndexEntry objects
//   3. sort: milestone ASC, status (active < in_progress < draft), ULID ASC
//   4. render Schema U table
//   5. atomic write: specs/.INDEX.md.tmp → rename to specs/INDEX.md
//
// Determinism: given identical inputs + identical `now`, output is
// byte-identical. Archived FRs are excluded (AC-45.3); frontmatter parsing
// is minimal (we only need id/title/milestone/status/tracker).

import { readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "./frontmatter";

export interface FRIndexEntry {
  id: string;
  title: string;
  milestone: string;
  status: "active" | "in_progress" | "draft";
  path: string;
  primary_tracker: { key: string; id: string } | null;
}

export interface RegenerateOptions {
  now?: string;
}

const STATUS_RANK: Record<string, number> = { active: 0, in_progress: 1, draft: 2 };

function toEntry(relPath: string, full: string): FRIndexEntry | null {
  const text = readFileSync(full, "utf-8");
  const fm = parseFrontmatter(text);
  const status = String(fm["status"] ?? "active");
  if (status === "archived") return null;
  if (status !== "active" && status !== "in_progress" && status !== "draft") return null;
  const tracker = (fm["tracker"] ?? {}) as Record<string, string | null>;
  const keys = Object.keys(tracker).sort();
  const primary: FRIndexEntry["primary_tracker"] =
    keys.length > 0 && tracker[keys[0]!] ? { key: keys[0]!, id: String(tracker[keys[0]!]) } : null;
  return {
    id: String(fm["id"] ?? ""),
    title: String(fm["title"] ?? ""),
    milestone: String(fm["milestone"] ?? ""),
    status: status as FRIndexEntry["status"],
    path: relPath,
    primary_tracker: primary,
  };
}

function sortEntries(entries: FRIndexEntry[]): FRIndexEntry[] {
  return entries.slice().sort((a, b) => {
    if (a.milestone !== b.milestone) return a.milestone < b.milestone ? -1 : 1;
    const sa = STATUS_RANK[a.status] ?? 99;
    const sb = STATUS_RANK[b.status] ?? 99;
    if (sa !== sb) return sa - sb;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

function renderMarkdown(entries: FRIndexEntry[], now: string): string {
  const header = [
    "# Active FRs",
    "",
    "| ULID | Title | Milestone | Status | Tracker |",
    "|------|-------|-----------|--------|---------|",
  ];
  const rows = entries.map((e) => {
    const tracker = e.primary_tracker ? `${e.primary_tracker.key}:${e.primary_tracker.id}` : "—";
    return `| [${e.id}](${e.path}) | ${e.title} | ${e.milestone} | ${e.status} | ${tracker} |`;
  });
  return `${header.join("\n")}\n${rows.join("\n")}${rows.length > 0 ? "\n" : ""}\nGenerated: ${now}\n`;
}

export async function regenerateIndex(specsDir: string, options: RegenerateOptions = {}): Promise<void> {
  const frsDir = join(specsDir, "frs");
  let activeFiles: string[];
  try {
    activeFiles = readdirSync(frsDir)
      .filter((f) => f.endsWith(".md"))
      .filter((f) => {
        const full = join(frsDir, f);
        try {
          return statSync(full).isFile();
        } catch {
          return false;
        }
      })
      .sort();
  } catch {
    activeFiles = [];
  }
  const entries: FRIndexEntry[] = [];
  for (const f of activeFiles) {
    const full = join(frsDir, f);
    const rel = `frs/${f}`;
    const entry = toEntry(rel, full);
    if (entry !== null) entries.push(entry);
  }
  const sorted = sortEntries(entries);
  const now = options.now ?? new Date().toISOString();
  const md = renderMarkdown(sorted, now);
  const target = join(specsDir, "INDEX.md");
  const tmp = join(specsDir, ".INDEX.md.tmp");
  try {
    writeFileSync(tmp, md);
    renameSync(tmp, target);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    throw err;
  }
}

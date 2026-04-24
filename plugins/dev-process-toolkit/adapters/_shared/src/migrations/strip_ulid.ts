// strip_ulid — one-shot migration tool (STE-86 AC-STE-86.1/2/3).
//
// Removes the `id: fr_<26-char ULID>` frontmatter line from every **tracker-mode**
// `.md` file under the given archive directory. Mode-none archives
// (frontmatter carries `tracker: {}` or no `tracker` key) are left
// byte-identical — mode-none identity IS the `id:` value, per NFR-15
// Invariant #2 (mode-scoped). Bimodal safety: hybrid archives containing
// mode-none files from earlier project history are preserved.
//
// Line-based surgery (no YAML round-trip) preserves byte-identical output
// except for the single removed line.
//
// Exit posture:
//   - `modified`: tracker-mode files that had a valid id line and were
//     (in write-mode) edited, or (in dry-run) would be edited.
//   - `skipped`: mode-none files (any state) + tracker-mode files with no
//     id line (already stripped).
//   - `errors`: files with a malformed id line. In write-mode, a non-empty
//     errors list disables ALL writes — all-or-nothing atomicity per AC-STE-86.2.
//
// Zero runtime dep on ulid.ts (AC-STE-86.8): ULID_REGEX is inlined as a
// private constant below. The module is semantically bimodal-invariant and
// must not cross the scope-3 isolation boundary around mode-none identity.
//
// Kept in-tree post-release for reproducibility — removing the script would
// make the commit that ran it unverifiable from a future checkout.

import { readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";

// AC-STE-86.8: inlined to avoid runtime dep on ulid.ts.
const ULID_ID_LINE_RE = /^id: fr_[0-9A-HJKMNP-TV-Z]{26}$/;
const ANY_ID_LINE_RE = /^id:\s*(.*)$/;

export interface StripUlidSummary {
  modified: string[];
  skipped: string[];
  errors: Array<{ file: string; reason: string }>;
}

export interface StripUlidOptions {
  dryRun: boolean;
}

interface PlannedWrite {
  path: string;
  newContent: string;
}

interface FileEvaluation {
  kind: "modify" | "skip" | "error";
  path: string;
  newContent?: string;
  reason?: string;
}

async function walkMdFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await walkMdFiles(full);
      out.push(...nested);
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      out.push(full);
    }
  }
  return out;
}

function extractFrontmatterRange(content: string): { start: number; end: number } | null {
  if (!content.startsWith("---\n")) return null;
  const closeIdx = content.indexOf("\n---", 4);
  if (closeIdx < 0) return null;
  return { start: 4, end: closeIdx };
}

/**
 * Heuristic for mode-none archives: frontmatter carries `tracker: {}`
 * (inline empty map) OR an empty multi-line `tracker:` block OR no tracker
 * key at all. Tracker-mode FRs carry `tracker:\n  <key>: <id>` with at
 * least one binding. We scan the frontmatter text line by line to avoid
 * depending on the shared YAML parser (keeps the migration tool
 * self-contained per AC-STE-86.8).
 */
function isModeNoneFrontmatter(fmLines: string[]): boolean {
  for (let i = 0; i < fmLines.length; i++) {
    const line = fmLines[i]!;
    // Inline empty map: `tracker: {}`
    if (/^tracker:\s*\{\s*\}\s*$/.test(line)) return true;
    // Multi-line `tracker:` (may or may not have entries below).
    if (/^tracker:\s*$/.test(line)) {
      // Look at the next line — if it's indented (a binding), tracker-mode;
      // if it's another top-level key or EOF, mode-none.
      const next = fmLines[i + 1];
      if (next === undefined) return true;
      if (!(next.startsWith("  ") || next.startsWith("\t"))) return true;
      return false;
    }
  }
  // No tracker key at all — treat as mode-none (defensive; the probe would
  // catch this as a Schema Q violation separately).
  return true;
}

function evaluateFile(path: string, content: string): FileEvaluation {
  const fmRange = extractFrontmatterRange(content);
  if (!fmRange) return { kind: "skip", path };

  const fmText = content.slice(fmRange.start, fmRange.end);
  const fmLines = fmText.split("\n");

  // Mode-safety gate: leave mode-none archives byte-identical (AC-STE-76.8,
  // NFR-15 mode-scoped Invariant #2). This tool strips only tracker-mode
  // ceremony; mode-none identity IS the id: value.
  if (isModeNoneFrontmatter(fmLines)) return { kind: "skip", path };

  const idHits: Array<{ lineIdx: number; line: string }> = [];
  for (let i = 0; i < fmLines.length; i++) {
    if (ANY_ID_LINE_RE.test(fmLines[i]!)) {
      idHits.push({ lineIdx: i, line: fmLines[i]! });
    }
  }

  if (idHits.length === 0) return { kind: "skip", path };

  if (idHits.length > 1) {
    return {
      kind: "error",
      path,
      reason: `duplicate id lines: ${idHits.length} occurrences in frontmatter`,
    };
  }

  const hit = idHits[0]!;
  if (!ULID_ID_LINE_RE.test(hit.line)) {
    return {
      kind: "error",
      path,
      reason: `malformed id line (expected "id: fr_<26-char ULID>"): ${JSON.stringify(hit.line)}`,
    };
  }

  // Remove exactly the matched line, preserving the surrounding frontmatter
  // and body byte-for-byte. The stored line does not include its trailing
  // newline, so we also swallow the newline that follows it.
  const newFmLines = fmLines.slice(0, hit.lineIdx).concat(fmLines.slice(hit.lineIdx + 1));
  const newFmText = newFmLines.join("\n");
  const newContent = content.slice(0, fmRange.start) + newFmText + content.slice(fmRange.end);
  return { kind: "modify", path, newContent };
}

/**
 * Scan every `.md` under `archiveDir` (recursive) and strip the
 * `id: fr_<ULID>` frontmatter line. In dry-run, returns the plan without
 * writing. In write-mode, applies all writes atomically (temp-file + rename
 * per file); any single error disables the entire write pass — caller
 * inspects `summary.errors` to decide next steps.
 */
export async function stripUlidFromArchive(
  archiveDir: string,
  opts: StripUlidOptions,
): Promise<StripUlidSummary> {
  const files = (await walkMdFiles(archiveDir)).sort();
  const modified: string[] = [];
  const skipped: string[] = [];
  const errors: Array<{ file: string; reason: string }> = [];
  const planned: PlannedWrite[] = [];

  for (const file of files) {
    let content: string;
    try {
      content = await readFile(file, "utf-8");
    } catch (err) {
      errors.push({ file, reason: `read failed: ${(err as Error).message}` });
      continue;
    }
    const evaluation = evaluateFile(file, content);
    if (evaluation.kind === "modify") {
      modified.push(evaluation.path);
      if (!opts.dryRun && evaluation.newContent !== undefined) {
        planned.push({ path: evaluation.path, newContent: evaluation.newContent });
      }
    } else if (evaluation.kind === "skip") {
      skipped.push(evaluation.path);
    } else {
      errors.push({ file: evaluation.path, reason: evaluation.reason ?? "unknown error" });
    }
  }

  if (opts.dryRun || errors.length > 0) {
    // AC-STE-86.2: all-or-nothing. If any file errored, no writes land.
    if (errors.length > 0 && !opts.dryRun) {
      // Report modified files as "would have been modified" — caller still
      // sees the plan, but nothing on disk has changed.
      return { modified: [], skipped, errors };
    }
    return { modified, skipped, errors };
  }

  // Per-file atomicity via temp-file + rename. On first failure, stop
  // writing further files and truncate the `modified` list to the subset
  // that actually landed so callers can see exactly what happened. The
  // dry-run pre-pass already rejected anything malformed, so a failure
  // here is a filesystem-level error (permissions, disk full, ENOENT on
  // a concurrently-removed path) — stopping immediately keeps the partial
  // state small and git-recoverable.
  const landed: string[] = [];
  for (let i = 0; i < planned.length; i++) {
    const plan = planned[i]!;
    const tmp = `${plan.path}.strip_ulid.tmp`;
    try {
      await writeFile(tmp, plan.newContent, "utf-8");
      await rename(tmp, plan.path);
      landed.push(plan.path);
    } catch (err) {
      errors.push({ file: plan.path, reason: `write failed: ${(err as Error).message}` });
      return { modified: landed, skipped, errors };
    }
  }

  return { modified: landed, skipped, errors };
}

/**
 * Pretty-print a summary for CLI output. Format is line-based and stable
 * so operators can diff between dry-run and apply runs.
 */
export function formatStripUlidSummary(summary: StripUlidSummary, root: string): string {
  const lines: string[] = [];
  lines.push(`modified: ${summary.modified.length}`);
  lines.push(`skipped:  ${summary.skipped.length}`);
  lines.push(`errors:   ${summary.errors.length}`);
  if (summary.errors.length > 0) {
    lines.push("");
    lines.push("ERRORS:");
    for (const err of summary.errors) {
      lines.push(`  ${relative(root, err.file) || err.file}: ${err.reason}`);
    }
  }
  return lines.join("\n");
}

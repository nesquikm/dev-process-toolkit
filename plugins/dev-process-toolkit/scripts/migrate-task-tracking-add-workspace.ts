// STE-117 AC-STE-117.9 — one-time migration helper for projects that ran
// `/setup` before the `### Linear` / `### Jira` workspace-binding sub-section
// was required.
//
// Dry-run only. Reads CLAUDE.md, detects active adapter from `mode:`, prompts
// for team + project on stdin (or accepts pre-baked values via env vars), and
// prints a unified diff that inserts the sub-section at the end of the
// `## Task Tracking` block. Operator pipes the diff to `patch -p1` if they
// want to apply.
//
// Same shape as `scripts/migrate-task-tracking-canonical.ts` (STE-114) — the
// LCS-aware diff renderer is duplicated here to keep the script
// single-file-self-contained (matching the STE-114 pattern; the diff renderer
// is small enough that DRY-via-import would invert the cost).

import { readFileSync } from "node:fs";
import { basename, isAbsolute } from "node:path";

interface ParsedSection {
  preamble: string[];
  heading: string;
  sectionLines: string[];
  afterLines: string[];
}

export interface WorkspaceMigrationInput {
  adapter: "linear" | "jira";
  team?: string;
  project: string;
}

function parse(content: string): ParsedSection | null {
  const lines = content.split("\n");
  const startIdx = lines.findIndex((l) => l === "## Task Tracking");
  if (startIdx < 0) return null;
  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    if (/^#{1,2}\s/.test(lines[i]!)) {
      endIdx = i;
      break;
    }
  }
  return {
    preamble: lines.slice(0, startIdx),
    heading: lines[startIdx]!,
    sectionLines: lines.slice(startIdx + 1, endIdx),
    afterLines: lines.slice(endIdx),
  };
}

function buildHunk(before: string[], after: string[]): string {
  const beforeLen = before.length;
  const afterLen = after.length;
  const header = `@@ -1,${beforeLen} +1,${afterLen} @@`;

  const dp: number[][] = Array.from({ length: beforeLen + 1 }, () =>
    new Array<number>(afterLen + 1).fill(0),
  );
  for (let i = 1; i <= beforeLen; i++) {
    for (let j = 1; j <= afterLen; j++) {
      const row = dp[i]!;
      const prevRow = dp[i - 1]!;
      if (before[i - 1] === after[j - 1]) row[j] = (prevRow[j - 1] ?? 0) + 1;
      else row[j] = Math.max(prevRow[j] ?? 0, row[j - 1] ?? 0);
    }
  }

  const ops: string[] = [];
  let i = beforeLen;
  let j = afterLen;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && before[i - 1] === after[j - 1]) {
      ops.push(` ${before[i - 1]}`);
      i--;
      j--;
    } else if (j > 0 && (i === 0 || (dp[i]?.[j - 1] ?? 0) >= (dp[i - 1]?.[j] ?? 0))) {
      ops.push(`+${after[j - 1]}`);
      j--;
    } else {
      ops.push(`-${before[i - 1]}`);
      i--;
    }
  }
  ops.reverse();
  return [header, ...ops].join("\n");
}

function detectMode(sectionLines: string[]): string | null {
  for (const line of sectionLines) {
    const m = /^mode:\s*(\S+)\s*$/.exec(line);
    if (m) return m[1]!;
  }
  return null;
}

function hasSubsection(sectionLines: string[], adapter: "linear" | "jira"): boolean {
  const title = adapter === "linear" ? "### Linear" : "### Jira";
  return sectionLines.some((l) => l === title);
}

/**
 * Pure helper. Returns a unified diff string that inserts the requested
 * sub-section into `## Task Tracking`. Empty string when no migration is
 * needed (mode: none, section absent, or sub-section already present).
 */
export function computeWorkspaceMigrationDiff(
  content: string,
  claudeMdPath: string,
  input: WorkspaceMigrationInput,
): string {
  const parsed = parse(content);
  if (!parsed) return "";
  const mode = detectMode(parsed.sectionLines);
  if (mode === null || mode === "none") return "";
  if (hasSubsection(parsed.sectionLines, input.adapter)) return "";

  const subTitle = input.adapter === "linear" ? "### Linear" : "### Jira";
  const newBlock: string[] = [];
  // Ensure a blank line before the sub-section if the existing section's
  // last non-empty line isn't already followed by a blank.
  const sectionTrimmed = [...parsed.sectionLines];
  while (sectionTrimmed.length > 0 && sectionTrimmed[sectionTrimmed.length - 1] === "") {
    sectionTrimmed.pop();
  }
  newBlock.push(...sectionTrimmed, "", subTitle, "");
  if (input.adapter === "linear") {
    if (!input.team) {
      throw new Error("linear migration requires team");
    }
    newBlock.push(`team: ${input.team}`);
    newBlock.push(`project: ${input.project}`);
  } else {
    newBlock.push(`project: ${input.project}`);
  }
  newBlock.push("");

  const before = [
    ...parsed.preamble,
    parsed.heading,
    ...parsed.sectionLines,
    ...parsed.afterLines,
  ];
  const after = [...parsed.preamble, parsed.heading, ...newBlock, ...parsed.afterLines];

  // Normalize the diff header path: absolute paths collapse to the bare
  // basename so `patch -p1` operates on `CLAUDE.md` regardless of where the
  // helper was invoked from. Relative paths keep their shape minus any
  // leading `./`. Matches the convention in
  // `scripts/migrate-task-tracking-canonical.ts` while fixing the absolute-
  // path edge case the canonical script doesn't normalize.
  const normalizedPath = isAbsolute(claudeMdPath)
    ? basename(claudeMdPath)
    : claudeMdPath.replace(/^[\/.]+/, "");
  const aPath = `a/${normalizedPath}`;
  const bPath = `b/${normalizedPath}`;
  const diffBody = buildHunk(before, after);
  return [`--- ${aPath}`, `+++ ${bPath}`, diffBody].join("\n");
}

async function readStdinLine(prompt: string): Promise<string> {
  process.stderr.write(prompt);
  const reader = (Bun as unknown as { stdin: { stream: () => ReadableStream<Uint8Array> } }).stdin.stream();
  const decoder = new TextDecoder();
  let buf = "";
  const r = reader.getReader();
  while (true) {
    const { value, done } = await r.read();
    if (value) buf += decoder.decode(value);
    if (done || buf.includes("\n")) break;
  }
  r.releaseLock();
  return buf.split("\n")[0]!.trim();
}

// CLI entry: bun run scripts/migrate-task-tracking-add-workspace.ts <CLAUDE.md path>
async function main(argv: string[]): Promise<number> {
  const path = argv[2];
  if (!path) {
    console.error("usage: migrate-task-tracking-add-workspace.ts <CLAUDE.md path>");
    return 1;
  }
  const content = readFileSync(path, "utf-8");
  const parsed = parse(content);
  if (!parsed) {
    console.error("# no migration needed — ## Task Tracking section absent (mode: none)");
    return 0;
  }
  const mode = detectMode(parsed.sectionLines);
  if (mode === null || mode === "none") {
    console.error("# no migration needed — mode: none");
    return 0;
  }
  if (mode !== "linear" && mode !== "jira") {
    console.error(`# no canonical workspace-binding sub-section defined for mode: ${mode}`);
    return 0;
  }
  if (hasSubsection(parsed.sectionLines, mode)) {
    console.error(`# no migration needed — ### ${mode === "linear" ? "Linear" : "Jira"} sub-section already present`);
    return 0;
  }

  const team =
    mode === "linear"
      ? process.env.DPT_MIGRATE_TEAM ?? (await readStdinLine("team (e.g., STE): "))
      : undefined;
  const project =
    process.env.DPT_MIGRATE_PROJECT ??
    (await readStdinLine(
      mode === "linear" ? "project (e.g., DPT — Dev Process Toolkit): " : "Jira project key (e.g., ENG): ",
    ));

  if (!project || (mode === "linear" && !team)) {
    console.error("error: missing required input");
    return 1;
  }

  const diff = computeWorkspaceMigrationDiff(content, path, {
    adapter: mode,
    team,
    project,
  });
  if (diff === "") {
    console.error("# no migration needed");
    return 0;
  }
  console.log(diff);
  return 0;
}

if (import.meta.main) {
  main(process.argv).then((code) => process.exit(code));
}

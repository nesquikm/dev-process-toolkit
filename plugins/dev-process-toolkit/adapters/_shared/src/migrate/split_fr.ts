// split_fr.ts — parse v1 requirements.md into FR blocks keyed by old FR id (AC-48.6).
//
// Grammar (lenient but deterministic):
//   - A heading `### FR-N: <title>` (optionally with `{#FR-N}` anchor) starts an FR block.
//   - The block extends until the next heading at the same or higher level
//     (`## ` or `### `), or end of file.
//   - The body is everything between the heading and the terminator,
//     minus a leading/trailing blank line.
//   - Acceptance criteria are extracted as the bulleted list under
//     `**Acceptance Criteria:**` (or `## Acceptance Criteria`) if present.
//
// Non-FR headings (e.g., `### NFR-N:`, `### Edge Cases`) are skipped.

export interface FrBlock {
  id: string; // e.g. "FR-1"
  title: string;
  anchor: string; // usually same as id
  body: string; // full block body (trimmed)
  acceptanceCriteria: string[]; // raw AC bullet lines, trimmed
}

const FR_HEADING_RE = /^###\s+(FR-\d+):\s+(.+?)(?:\s*\{#([A-Za-z0-9_-]+)\})?\s*$/;
const ANY_HEADING_RE = /^(#{1,6})\s+/;

export function splitFrs(markdown: string): Map<string, FrBlock> {
  const lines = markdown.split("\n");
  const out = new Map<string, FrBlock>();
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const match = FR_HEADING_RE.exec(line);
    if (!match) {
      i++;
      continue;
    }
    const id = match[1]!;
    const title = match[2]!.trim();
    const anchor = match[3] ?? id;
    // find block end: next ## or ### heading, or end of file
    let j = i + 1;
    while (j < lines.length) {
      const h = ANY_HEADING_RE.exec(lines[j]!);
      if (h && h[1]!.length <= 3) break;
      j++;
    }
    const bodyLines = lines.slice(i + 1, j);
    // trim leading/trailing blank lines
    while (bodyLines.length > 0 && bodyLines[0]!.trim() === "") bodyLines.shift();
    while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1]!.trim() === "") bodyLines.pop();
    const body = bodyLines.join("\n");
    const acceptanceCriteria = extractAcs(body);
    out.set(id, { id, title, anchor, body, acceptanceCriteria });
    i = j;
  }
  return out;
}

function extractAcs(body: string): string[] {
  const lines = body.split("\n");
  const acs: string[] = [];
  let inBlock = false;
  for (const raw of lines) {
    const line = raw;
    if (/^\*\*Acceptance Criteria:\*\*\s*$/.test(line) || /^##+\s+Acceptance Criteria\s*$/.test(line)) {
      inBlock = true;
      continue;
    }
    if (inBlock) {
      if (line.trim() === "") {
        // blank line: tolerate up to one blank, end on another heading
        continue;
      }
      if (/^#{1,6}\s+/.test(line) || /^\*\*[^*]/.test(line)) {
        break;
      }
      if (/^\s*-\s+/.test(line)) {
        acs.push(line.trim());
      }
    }
  }
  return acs;
}

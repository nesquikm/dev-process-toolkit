// convert_archive.ts — parse a single v1 `specs/archive/M*.md` file
// (Schema G) into its constituent FR blocks, preserving archival date
// (AC-48.9).

import { parseFrontmatterFlat } from "../frontmatter";
import { splitFrs } from "./split_fr";

export interface ArchivedFr {
  oldId: string;
  title: string;
  body: string;
  acceptanceCriteria: string[];
}

export interface ArchiveFileResult {
  milestone: string;
  title: string;
  archivedAt: string; // ISO datetime (YYYY-MM-DD → YYYY-MM-DDT00:00:00Z)
  frs: ArchivedFr[];
}

function normalizeDate(raw: string): string {
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return `${trimmed}T00:00:00Z`;
  if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return trimmed;
  // Fallback: empty string means missing — caller decides what to do
  return trimmed;
}

export function convertArchiveFile(markdown: string): ArchiveFileResult {
  const fm = parseFrontmatterFlat(markdown);
  const milestone = fm["milestone"] ?? "";
  const title = fm["title"] ?? "";
  const archivedAt = normalizeDate(fm["archived"] ?? "");

  // Extract FR blocks from the "Requirements block" section by reusing splitFrs.
  // splitFrs is heading-driven, so it picks up `### FR-N:` regardless of the
  // surrounding `## Requirements block` parent.
  const blocks = splitFrs(markdown);
  const frs: ArchivedFr[] = [];
  for (const [oldId, block] of blocks.entries()) {
    const cleanBody = block.body.replace(/\*\*Acceptance Criteria:\*\*[\s\S]*$/m, "").trim();
    frs.push({
      oldId,
      title: block.title,
      body: cleanBody,
      acceptanceCriteria: block.acceptanceCriteria,
    });
  }

  return { milestone, title, archivedAt, frs };
}

export function renderArchivedFrFile(params: {
  newId: string;
  oldId: string;
  title: string;
  milestone: string;
  archivedAt: string;
  createdAt: string;
  body: string;
  acceptanceCriteria: string[];
  sourceFile: string;
}): string {
  const acBlock =
    params.acceptanceCriteria.length > 0
      ? params.acceptanceCriteria.join("\n")
      : "*(no acceptance criteria recorded in v1 archive)*";
  const lines = [
    "---",
    `id: ${params.newId}`,
    `title: ${params.title}`,
    `milestone: ${params.milestone}`,
    `status: archived`,
    `archived_at: ${params.archivedAt}`,
    `tracker: {}`,
    `created_at: ${params.createdAt}`,
    "---",
    "",
    "## Requirement",
    "",
    params.body,
    "",
    "## Acceptance Criteria",
    "",
    acBlock,
    "",
    "## Technical Design",
    "",
    "*(not present in v1 archive; left empty during migration)*",
    "",
    "## Testing",
    "",
    "*(not present in v1 archive; left empty during migration)*",
    "",
    "## Notes",
    "",
    `Migrated from \`${params.sourceFile}\` by \`/setup --migrate\` on ${params.createdAt.slice(0, 10)}; original archived date preserved.`,
    "",
  ];
  return lines.join("\n");
}

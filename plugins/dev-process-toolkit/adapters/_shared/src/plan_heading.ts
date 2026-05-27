// STE-335 AC-STE-335.1 / .6 — shared plan-heading parser.
//
// `parsePlanHeading(md)` matches a milestone heading at EITHER `#` or `##`
// depth, with EITHER an em-dash (—) or colon (:) separator, and an optional
// trailing `{#M<N>}` anchor. It returns the canonical milestone name
// normalized to `M<N> — <title>` (em-dash, regardless of source separator),
// or `null` when no milestone heading is present.
//
// The heading need not be on the first line — frontmatter, blank lines, or
// prose may precede it (the regex is multi-line, anchored per line). For the
// colon form only the FIRST `:` is the separator; any further `:` (or `/`)
// belong to the title and are captured whole.

const MILESTONE_HEADING_RE =
  /^#{1,2}[ \t]+M(\d+)[ \t]*(?:—|:)[ \t]*(.+?)(?:[ \t]*\{#M\d+\})?[ \t]*$/m;

/**
 * Parse the first milestone heading in `md` and return its canonical name
 * (`M<N> — <title>` with a U+2014 em-dash separator and no `{#M<N>}` anchor),
 * or `null` when no `#`/`##` milestone heading is present.
 */
export function parsePlanHeading(md: string): string | null {
  const match = md.match(MILESTONE_HEADING_RE);
  if (!match) return null;
  const number = match[1];
  const title = match[2].trim();
  return `M${number} — ${title}`;
}

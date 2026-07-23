// STE-335 AC-STE-335.1 / .6 + STE-376 AC-STE-376.2 — shared plan-heading parser.
//
// `parsePlanHeading(md)` matches a milestone heading at EITHER `#` or `##`
// depth, with EITHER an em-dash (—) or colon (:) separator, and an optional
// trailing `{#M<token>}` anchor. The milestone token is the union grammar
// from milestone_token.ts — numeric `M<N>` or Epic-keyed `M_<epic-key>`. It
// returns the canonical milestone name normalized to `<token> — <title>`
// (em-dash, regardless of source separator), or `null` when no milestone
// heading is present.
//
// The heading need not be on the first line — frontmatter, blank lines, or
// prose may precede it (the regex is multi-line, anchored per line). For the
// colon form only the FIRST `:` is the separator; any further `:` (or `/`)
// belong to the title and are captured whole.

import { MILESTONE_TOKEN_SOURCE } from "./milestone_token";

// The ONE live heading matcher (STE-335 AC-7). Composed at module load from
// the shared milestone_token union source: the token leaf embeds captured
// (whole token — `M31` / `M_PROJ_500`) in the heading position and
// no-capture inside the optional `{#M<token>}` anchor.
const MILESTONE_HEADING_RE = new RegExp(
  String.raw`^#{1,2}[ \t]+(${MILESTONE_TOKEN_SOURCE})[ \t]*(?:—|:)[ \t]*(.+?)(?:[ \t]*\{#${MILESTONE_TOKEN_SOURCE}\})?[ \t]*$`,
  "m",
);

/**
 * Parse the first milestone heading in `md` and return its canonical name
 * (`<token> — <title>` with a U+2014 em-dash separator and no `{#M<token>}`
 * anchor, where `<token>` is `M<N>` or `M_<epic-key>` verbatim), or `null`
 * when no `#`/`##` milestone heading is present.
 */
export function parsePlanHeading(md: string): string | null {
  const match = md.match(MILESTONE_HEADING_RE);
  if (!match) return null;
  const token = match[1];
  const title = match[2].trim();
  return `${token} — ${title}`;
}

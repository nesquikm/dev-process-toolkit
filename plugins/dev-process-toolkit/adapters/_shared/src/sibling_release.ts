// sibling_release — the one reader of a sibling repository's plan for a
// milestone (STE-588).
//
// A spanning milestone has a plan in each repository it names. This module
// finds the sibling's copy at either of its two homes — the live
// `specs/plan/<M>.md` and the archived `specs/plan/archive/<M>.md` — and reads
// its frontmatter through the shared parser, so CRLF and BOM fold once.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseFrontmatter } from "./frontmatter";
import { SPANS_REPOS_KEY } from "./spans_repos";

/**
 * The reason a sibling leg reports when the LOCAL plan's declaration refuses
 * to parse. `refusal` is the parser's NFR-10 message; its `Refusing:` line is
 * carried after `malformed <key>`. The key is spelled here, not borrowed from
 * the refusal's wording — a refusal that already leads with the key is not
 * repeated.
 */
export function malformedDeclarationReason(milestone: string, refusal: string): string {
  const refusing = refusalLine(refusal, "Refusing");
  const detail = refusing.startsWith(SPANS_REPOS_KEY)
    ? refusing.slice(SPANS_REPOS_KEY.length)
    : `: ${refusing}`;
  return `cannot grade the sibling half of ${milestone}: malformed ${SPANS_REPOS_KEY}${detail}`;
}

/**
 * The body of one labelled line of an NFR-10 refusal — its `Refusing:`,
 * `Remedy:` or `Context:` line — without the label, or `""` when the refusal
 * carries no such line. A row splices a BODY into its own shape, never the whole
 * three-line refusal, so it keeps exactly one line per label.
 */
export function refusalLine(refusal: string, label: "Refusing" | "Remedy" | "Context"): string {
  const prefix = `${label}: `;
  const line = refusal.split("\n").find((l) => l.startsWith(prefix));
  return line === undefined ? "" : line.slice(prefix.length);
}

/** A sibling repository's plan for one milestone, as read from disk. */
export interface SiblingPlan {
  /** Absolute path of the plan file that was read. */
  readonly file: string;
  /** The plan body, verbatim. */
  readonly body: string;
  /** The plan's frontmatter, read leniently through the shared parser. */
  readonly frontmatter: Record<string, unknown>;
}

/** The sibling's two plan paths for `milestone`: archived first, then live. */
export function siblingPlanPaths(siblingRoot: string, milestone: string): string[] {
  const name = `${milestone}.md`;
  return [
    join(siblingRoot, "specs", "plan", "archive", name),
    join(siblingRoot, "specs", "plan", name),
  ];
}

/**
 * Read the sibling's plan for `milestone` from whichever of its two paths
 * holds one, or `null` when neither does.
 */
export async function readSiblingPlan(
  siblingRoot: string,
  milestone: string,
): Promise<SiblingPlan | null> {
  for (const file of siblingPlanPaths(siblingRoot, milestone)) {
    let body: string;
    try {
      body = await readFile(file, "utf-8");
    } catch {
      continue;
    }
    return { file, body, frontmatter: parseFrontmatter(body, { lenient: true }) };
  }
  return null;
}

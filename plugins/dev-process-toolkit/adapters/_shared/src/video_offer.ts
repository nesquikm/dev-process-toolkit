// STE-670 — front door for the /ship-milestone video offer (AC-STE-670.1).
//
//   bun run video_offer.ts <projectRoot> <milestone>
//
// When `videoReadiness` reports ready AND at least one Added/Changed FR is
// bound to the milestone, prints `slug=<milestone-slug>` then one
// `fr=<id> <title>` line per such FR. Otherwise prints nothing and exits 0.
// FRs are read from specs/frs and specs/frs/archive; the milestone title from
// the plan heading in specs/plan or specs/plan/archive.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseFrontmatter } from "./frontmatter";
import { parsePlanHeading } from "./plan_heading";
import { videoReadiness } from "./video/readiness";

const OFFER_CATEGORIES = new Set(["Added", "Changed"]);
const SLUG_MAX = 40;

export interface OfferFr {
  id: string;
  title: string;
}

/** Lowercase kebab-case of `title`, at most 40 characters, no edge hyphens. */
export function milestoneSlug(title: string): string {
  const full = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return full.slice(0, SLUG_MAX).replace(/-+$/g, "");
}

function mdFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => join(dir, f));
}

/** Added/Changed FRs bound to `milestone`, from specs/frs and its archive. */
export function offerFrs(projectRoot: string, milestone: string): OfferFr[] {
  const out: OfferFr[] = [];
  for (const dir of [join(projectRoot, "specs", "frs"), join(projectRoot, "specs", "frs", "archive")]) {
    for (const path of mdFiles(dir)) {
      const fm = parseFrontmatter(readFileSync(path, "utf8"), { lenient: true });
      if (String(fm.milestone ?? "") !== milestone) continue;
      if (!OFFER_CATEGORIES.has(String(fm.changelog_category ?? ""))) continue;
      out.push({ id: basename(path, ".md"), title: String(fm.title ?? "").trim() });
    }
  }
  return out;
}

/** The milestone title from its plan heading (active plan first, then archive). */
export function milestoneTitle(projectRoot: string, milestone: string): string | null {
  for (const dir of [join(projectRoot, "specs", "plan"), join(projectRoot, "specs", "plan", "archive")]) {
    const path = join(dir, `${milestone}.md`);
    if (!existsSync(path)) continue;
    const heading = parsePlanHeading(readFileSync(path, "utf8"));
    if (heading === null) continue;
    const sep = heading.indexOf(" — ");
    return sep === -1 ? heading : heading.slice(sep + " — ".length);
  }
  return null;
}

/** The offer lines, or `[]` when the offer must not fire. */
export function videoOfferLines(projectRoot: string, milestone: string): string[] {
  if (!videoReadiness(projectRoot).ready) return [];
  const frs = offerFrs(projectRoot, milestone);
  if (frs.length === 0) return [];
  const slug = milestoneSlug(milestoneTitle(projectRoot, milestone) ?? milestone);
  return [`slug=${slug}`, ...frs.map((fr) => `fr=${fr.id} ${fr.title}`)];
}

if (import.meta.main) {
  const [rootArg, milestone = ""] = process.argv.slice(2);
  const projectRoot = resolve(rootArg ?? process.cwd());
  const lines = videoOfferLines(projectRoot, milestone);
  if (lines.length > 0) console.log(lines.join("\n"));
}

// scanCandidateCheckSkills (STE-347 AC-STE-347.2) — the fallback leg of the
// `## Verification` discovery-precedence resolver. Given a project root, scan
// `.claude/skills/*/SKILL.md` for project-local skills that look like a
// verification ("check") skill and return them for the caller to adopt (one
// candidate), disambiguate (many), or fall through to "no check declared"
// (none). Read-only — never writes, never invokes anything.
//
// A skill dir is a candidate iff it has a `SKILL.md` file AND either:
//   - its slug (the directory name) contains the substring `drive`, `check`,
//     or `verify`, OR
//   - its SKILL.md frontmatter carries the explicit `verify: true` marker.
//
// The marker match is frontmatter-scoped: `verify: false` is not a match, and
// a `verify: true` that only appears in the skill body (outside the leading
// `---` block) is not a match. A skill matched by both slug and marker is
// returned exactly once. Results are slug-sorted for deterministic output;
// multiple candidates are all returned (the caller decides — never guesses).
// Absent/empty `.claude/skills` yields `[]`.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "./frontmatter";

export interface CandidateCheckSkill {
  slug: string;
  path: string;
}

const SLUG_PATTERNS = ["drive", "check", "verify"];

/**
 * True iff the leading `---` frontmatter block carries `verify: true`.
 *
 * Delegates key parsing to the shared `parseFrontmatter` helper, but gates on a
 * literal leading `---\n` first: `parseFrontmatter`'s regex carries the `/m`
 * flag (it would match a `---`-delimited block anywhere in the file), whereas
 * this discovery leg must be strict about line 0 — a `verify: true` that
 * appears only in the skill body must never produce a false-positive candidate
 * the resolver would offer to run.
 */
function hasVerifyMarker(content: string): boolean {
  if (!content.startsWith("---\n")) return false;
  return parseFrontmatter(content, { lenient: true }).verify === true;
}

export function scanCandidateCheckSkills(
  projectRoot: string,
): CandidateCheckSkill[] {
  const skillsDir = join(projectRoot, ".claude", "skills");
  if (!existsSync(skillsDir)) return [];

  const candidates: CandidateCheckSkill[] = [];
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    const skillMd = join(skillsDir, slug, "SKILL.md");
    if (!existsSync(skillMd)) continue;

    const slugMatch = SLUG_PATTERNS.some((p) => slug.includes(p));
    let markerMatch = false;
    if (!slugMatch) {
      try {
        markerMatch = hasVerifyMarker(readFileSync(skillMd, "utf-8"));
      } catch {
        markerMatch = false;
      }
    }
    if (slugMatch || markerMatch) candidates.push({ slug, path: skillMd });
  }

  candidates.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return candidates;
}

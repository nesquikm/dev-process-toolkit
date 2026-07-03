// scaffold_check_skill (STE-348) — write a stack-aware, project-local
// verification ("drive") skill into a project's `.claude/skills/<slug>/
// SKILL.md`. Shared by `/setup`'s opt-in seed step and `/implement`'s
// Phase 4b″ scaffold-if-missing offer.
//
// Templates ship with the plugin under
// `templates/check-skill/<key>.SKILL.md.template` and are resolved relative
// to THIS module's location (never the caller-controlled projectRoot), so the
// shipped stubs are always found regardless of where the target project lives.
// The caller controls only `projectRoot` (the output directory) and `slug`.
//
// Stack → template-key mapping (case-insensitive):
//   flutter / dart                                 → flutter
//   web / js / ts / node / typescript / javascript → web
//   python / api                                   → python
//   anything else                                  → generic
//
// Collision-safe: an existing `.claude/skills/<slug>/SKILL.md` is NEVER
// overwritten — the slug is de-duplicated (`-2`, `-3`, …) until a free
// directory is found and the stub is written THERE. The returned `slug`
// carries whichever name actually got written.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Safe skill-directory charset — letters, digits, hyphens, underscores. The
 * `slug` is operator-overridable free text (`/setup` step 8c), and it flows
 * into a filesystem write path AND renderStub's substitution, so it is
 * validated here at the entry boundary. This rejects path separators and `..`
 * (which would escape `.claude/skills/` and break the never-overwrite
 * collision guarantee) and `$`-tokens (which would splice template text at
 * render time). The `-N` collision suffix stays within this charset.
 */
const SAFE_SLUG_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Thrown when `slug` is not a safe skill-directory name. Named (rather than a
 * bare `Error`) to match the sibling `MalformedVerificationConfigError`
 * convention in this milestone so callers can branch on the error type.
 */
export class UnsafeSlugError extends Error {
  readonly slug: string;
  constructor(slug: string) {
    super(
      `scaffoldCheckSkill: slug ${JSON.stringify(slug)} is not a safe skill-` +
        `directory name — only letters, digits, hyphens, and underscores are ` +
        `allowed (no path separators, "..", "." or "$"). This guards the ` +
        `never-overwrite collision contract against path traversal.`,
    );
    this.name = "UnsafeSlugError";
    this.slug = slug;
  }
}

export interface ScaffoldCheckSkillOptions {
  /** Output project root; the stub lands under `<projectRoot>/.claude/skills/`. */
  projectRoot: string;
  /** Detected stack (case-insensitive); maps to a template key. */
  stack: string;
  /** Desired skill slug, e.g. `myapp-drive`. */
  slug: string;
}

export interface ScaffoldCheckSkillResult {
  /** Absolute path of the SKILL.md that was written. */
  path: string;
  /** `true` on a successful scaffold (fresh write or de-duplicated write). */
  wrote: boolean;
  /** The slug actually written — the input slug, or a `-N` de-dup of it. */
  slug: string;
}

/** The four stack template keys this helper knows how to render. */
export type TemplateKey = "flutter" | "web" | "python" | "generic";

/**
 * Map a detected stack string to a check-skill template key. Case-insensitive;
 * unknown stacks fall back to `generic`. Factored out so callers and tests can
 * reason about the mapping independently of the file I/O.
 */
export function stackToTemplateKey(stack: string): TemplateKey {
  switch (stack.trim().toLowerCase()) {
    case "flutter":
    case "dart":
      return "flutter";
    case "web":
    case "js":
    case "ts":
    case "node":
    case "typescript":
    case "javascript":
      return "web";
    case "python":
    case "api":
      return "python";
    default:
      return "generic";
  }
}

/**
 * Resolve + read the shipped template for a stack key, relative to THIS
 * module's own location so the render is independent of the caller's
 * projectRoot. `adapters/_shared/src/scaffold_check_skill.ts` sits three
 * levels below the plugin root, where `templates/` lives.
 */
function readTemplate(key: TemplateKey): string {
  const templatePath = join(
    import.meta.dir,
    "..",
    "..",
    "..",
    "templates",
    "check-skill",
    `${key}.SKILL.md.template`,
  );
  return readFileSync(templatePath, "utf8");
}

/**
 * Substitute the resolved slug into the template's identity placeholders so
 * the written stub is coherent with the directory it lands in (== the
 * `verify_skill` value /setup writes). `<slug>` and `<name>` are the two
 * tool-filled identity markers (distinct from the user-filled `TODO`s); both
 * become the resolved slug. Using the RESOLVED slug matters on a collision
 * bump — a `foo-drive-2` directory gets `name: foo-drive-2`, not `foo-drive`.
 */
function renderStub(template: string, resolvedSlug: string): string {
  // Function-form replacement so the substituted value is inserted literally —
  // a string replacement argument is scanned for `$&` / `$$` / `` $` `` tokens
  // even when the search value is a plain string. Defense-in-depth: the entry
  // guard already restricts `slug` to a `$`-free charset (SAFE_SLUG_RE).
  return template
    .replaceAll("<slug>", () => resolvedSlug)
    .replaceAll("<name>", () => resolvedSlug);
}

/**
 * De-duplicate `slug` against existing `.claude/skills/<slug>/SKILL.md` files
 * under `skillsRoot`, returning the first free name (`slug`, `slug-2`, …). A
 * pre-existing skill is never targeted, so its file is left byte-unchanged.
 */
function freeSlug(skillsRoot: string, slug: string): string {
  const taken = (candidate: string): boolean =>
    existsSync(join(skillsRoot, candidate, "SKILL.md"));
  if (!taken(slug)) return slug;
  let n = 2;
  while (taken(`${slug}-${n}`)) n++;
  return `${slug}-${n}`;
}

export function scaffoldCheckSkill({
  projectRoot,
  stack,
  slug,
}: ScaffoldCheckSkillOptions): ScaffoldCheckSkillResult {
  if (!SAFE_SLUG_RE.test(slug)) throw new UnsafeSlugError(slug);
  const template = readTemplate(stackToTemplateKey(stack));
  const skillsRoot = join(projectRoot, ".claude", "skills");
  const resolvedSlug = freeSlug(skillsRoot, slug);
  const dir = join(skillsRoot, resolvedSlug);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "SKILL.md");
  writeFileSync(path, renderStub(template, resolvedSlug));
  return { path, wrote: true, slug: resolvedSlug };
}

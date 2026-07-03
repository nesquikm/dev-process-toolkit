// Unit tests for scaffoldCheckSkill (STE-348 AC-STE-348.1 / .2 / .5).
//
// The shared scaffold helper used by both /setup and /implement to write a
// stack-aware project-local check ("drive") skill into a project's
// `.claude/skills/<slug>/SKILL.md`.
//
// Signature (module does not exist yet — these tests are RED until it lands):
//
//   scaffoldCheckSkill({ projectRoot, stack, slug }: {
//     projectRoot: string; stack: string; slug: string;
//   }) => { path: string; wrote: boolean; slug: string }
//
// Contract encoded here (from the FR's Technical Design + Phase-1 bindings):
//   - Templates are resolved relative to the helper's OWN module location
//     (join(import.meta.dir, "..", "..", "..", "templates", "check-skill",
//     "<stack-key>.SKILL.md.template")), so callers only control projectRoot
//     (the output dir). The test therefore never controls template location.
//   - Stack → template-key mapping: flutter/dart → flutter; web / js / ts /
//     node / typescript / javascript → web; python / api → python; anything
//     else → generic.
//   - Fresh write → { wrote: true, slug: <input>, path } and the rendered
//     stub is non-empty and carries `disable-model-invocation: true`.
//   - Collision-safe (AC-STE-348.5): if `.claude/skills/<slug>/SKILL.md`
//     already exists, the helper NEVER overwrites it — it de-duplicates the
//     slug (`-2`, `-3`, … until free), writes THERE, and returns
//     { wrote: true, slug: "<slug>-2", path: <alternate> }. The pre-existing
//     file is byte-unchanged.
//
// mkdtemp-per-render isolation mirrors the sibling scan_candidate_check_skills
// / docs_config tests.

import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { UnsafeSlugError, scaffoldCheckSkill } from "./scaffold_check_skill";

const tmpDirs: string[] = [];

/** Fresh isolated project root (output dir) for one scaffold call. */
function mkRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "dpt-scaffoldck-"));
  tmpDirs.push(dir);
  return dir;
}

/** Pre-create `.claude/skills/<slug>/SKILL.md` with sentinel content. */
function seedSkill(projectRoot: string, slug: string, body: string): string {
  const dir = join(projectRoot, ".claude", "skills", slug);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, "SKILL.md");
  writeFileSync(p, body);
  return p;
}

/** Render a stub into a fresh root with a fixed slug; return file content. */
function render(stack: string, slug = "app-drive"): string {
  const root = mkRoot();
  const res = scaffoldCheckSkill({ projectRoot: root, stack, slug });
  return readFileSync(res.path, "utf8");
}

afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

describe("scaffoldCheckSkill — fresh write (AC-STE-348.1)", () => {
  test("writes a non-empty stub to .claude/skills/<slug>/SKILL.md and reports wrote:true", () => {
    const root = mkRoot();
    const res = scaffoldCheckSkill({
      projectRoot: root,
      stack: "flutter",
      slug: "myapp-drive",
    });
    expect(res.wrote).toBe(true);
    expect(res.slug).toBe("myapp-drive");
    expect(res.path).toBe(
      join(root, ".claude", "skills", "myapp-drive", "SKILL.md"),
    );
    expect(existsSync(res.path)).toBe(true);
    expect(readFileSync(res.path, "utf8").length).toBeGreaterThan(0);
  });

  test("rendered stub carries disable-model-invocation: true", () => {
    const content = render("flutter");
    expect(content).toContain("disable-model-invocation: true");
  });

  test("rendered stub carries the runnable-shaped sections", () => {
    const content = render("flutter");
    expect(content).toContain("## What this checks");
    expect(content).toContain("## How to run");
  });
});

describe("scaffoldCheckSkill — stack → template-key mapping (AC-STE-348.1)", () => {
  test("flutter and dart resolve the SAME (flutter) template", () => {
    expect(render("dart")).toBe(render("flutter"));
  });

  test("web / js / ts / node / typescript / javascript resolve the SAME (web) template", () => {
    const web = render("web");
    for (const alias of ["js", "ts", "node", "typescript", "javascript"]) {
      expect(render(alias)).toBe(web);
    }
  });

  test("python and api resolve the SAME (python) template", () => {
    expect(render("api")).toBe(render("python"));
  });

  test("an unknown stack falls back to the generic template", () => {
    expect(render("cobol")).toBe(render("generic"));
  });

  test("the four stack templates are pairwise distinct", () => {
    const flutter = render("flutter");
    const web = render("web");
    const python = render("python");
    const generic = render("generic");
    const all = [flutter, web, python, generic];
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        expect(all[i]).not.toBe(all[j]);
      }
    }
  });

  test("every stack key renders a non-empty stub with the disable marker", () => {
    for (const stack of ["flutter", "web", "python", "generic"]) {
      const content = render(stack);
      expect(content.length).toBeGreaterThan(0);
      expect(content).toContain("disable-model-invocation: true");
    }
  });
});

describe("scaffoldCheckSkill — collision safety + idempotency (AC-STE-348.5)", () => {
  const SENTINEL = "HAND EDITED — do not clobber\n";

  test("existing slug ⇒ writes to the -2 alternate, original byte-unchanged", () => {
    const root = mkRoot();
    const originalPath = seedSkill(root, "foo-drive", SENTINEL);

    const res = scaffoldCheckSkill({
      projectRoot: root,
      stack: "flutter",
      slug: "foo-drive",
    });

    // Returned the de-duplicated slug + its path, and DID write there.
    expect(res.wrote).toBe(true);
    expect(res.slug).toBe("foo-drive-2");
    expect(res.path).toBe(
      join(root, ".claude", "skills", "foo-drive-2", "SKILL.md"),
    );

    // The pre-existing hand-edited file is untouched.
    expect(readFileSync(originalPath, "utf8")).toBe(SENTINEL);

    // The alternate is a real rendered stub.
    const alt = readFileSync(res.path, "utf8");
    expect(alt.length).toBeGreaterThan(0);
    expect(alt).toContain("disable-model-invocation: true");
  });

  test("increments -2, -3, … until a free slug is found; all originals untouched", () => {
    const root = mkRoot();
    const p1 = seedSkill(root, "foo-drive", SENTINEL);
    const p2 = seedSkill(root, "foo-drive-2", "SENTINEL 2\n");

    const res = scaffoldCheckSkill({
      projectRoot: root,
      stack: "web",
      slug: "foo-drive",
    });

    expect(res.slug).toBe("foo-drive-3");
    expect(res.wrote).toBe(true);
    expect(existsSync(res.path)).toBe(true);
    // Both pre-existing files survive byte-for-byte.
    expect(readFileSync(p1, "utf8")).toBe(SENTINEL);
    expect(readFileSync(p2, "utf8")).toBe("SENTINEL 2\n");
  });
});

// Backfill (STE-348 spec-deviation, underspecified): the helper knows the
// resolved slug, so the rendered stub must be identity-coherent — its
// frontmatter `name:` (and heading/description) must equal the resolved slug
// (== the directory it lands in == the `verify_skill` value /setup writes),
// with no un-substituted `<slug>` / `<name>` placeholders left behind. The
// audit caught the verbatim-copy divergence: dir `<slug>-drive` vs template
// `name: <slug>-check`.
describe("scaffoldCheckSkill — slug interpolation / identity coherence", () => {
  test("rendered frontmatter name equals the slug; no placeholder tokens remain", () => {
    const content = render("flutter", "myapp-drive");
    // name matches the directory + verify_skill value, not a `<slug>-check`
    // literal.
    expect(content).toMatch(/^name:\s*myapp-drive\s*$/m);
    expect(content).not.toContain("<slug>");
    expect(content).not.toContain("<name>");
  });

  test("interpolation uses the RESOLVED slug on collision, not the input slug", () => {
    const root = mkRoot();
    seedSkill(root, "foo-drive", "HAND EDITED\n");
    const res = scaffoldCheckSkill({
      projectRoot: root,
      stack: "web",
      slug: "foo-drive",
    });
    // Collision bumped the slug to foo-drive-2; the written stub's name must
    // track the actual directory it landed in.
    expect(res.slug).toBe("foo-drive-2");
    const content = readFileSync(res.path, "utf8");
    expect(content).toMatch(/^name:\s*foo-drive-2\s*$/m);
    expect(content).not.toContain("<slug>");
    expect(content).not.toContain("<name>");
  });

  test("every stack template renders with a substituted name", () => {
    for (const stack of ["flutter", "web", "python", "generic"]) {
      const content = render(stack, "svc-drive");
      expect(content).toMatch(/^name:\s*svc-drive\s*$/m);
      expect(content).not.toContain("<slug>");
      expect(content).not.toContain("<name>");
    }
  });
});

// Security backfill (Pass-2 review): `slug` is operator-overridable free text
// (docs/setup-reference.md step 8c). It flows into a filesystem write path AND
// into renderStub's string substitution, so it must be validated to a safe
// skill-directory charset — otherwise a `..` segment escapes .claude/skills/
// (breaking the never-overwrite guarantee) or a `$&`-style token splices
// template text at render time.
describe("scaffoldCheckSkill — slug validation (path traversal + substitution safety)", () => {
  for (const bad of ["../evil", "..", "foo/bar", "a\\b", "a$b", "a b", "", "a.b"]) {
    test(`rejects unsafe slug ${JSON.stringify(bad)} and writes nothing outside .claude/skills/`, () => {
      const root = mkRoot();
      expect(() =>
        scaffoldCheckSkill({ projectRoot: root, stack: "generic", slug: bad }),
      ).toThrow();
      // No stray file escaped the skills tree (e.g. a sibling `evil/SKILL.md`).
      expect(existsSync(join(root, "evil", "SKILL.md"))).toBe(false);
      expect(existsSync(join(root, "SKILL.md"))).toBe(false);
    });
  }

  test("rejection throws the named UnsafeSlugError carrying the offending slug", () => {
    const root = mkRoot();
    try {
      scaffoldCheckSkill({ projectRoot: root, stack: "generic", slug: "../x" });
      throw new Error("expected UnsafeSlugError");
    } catch (e) {
      expect(e).toBeInstanceOf(UnsafeSlugError);
      expect((e as UnsafeSlugError).slug).toBe("../x");
    }
  });

  test("accepts the canonical kebab + collision-suffixed slugs", () => {
    const root = mkRoot();
    const res = scaffoldCheckSkill({
      projectRoot: root,
      stack: "generic",
      slug: "my_app-drive",
    });
    expect(res.wrote).toBe(true);
    expect(res.slug).toBe("my_app-drive");
  });
});

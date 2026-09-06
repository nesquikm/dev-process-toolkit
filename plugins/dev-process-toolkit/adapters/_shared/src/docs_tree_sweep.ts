// docs_tree_sweep — readers over the live doc tree, for the classes of drift
// that a corrected sentence does not close.
//
// WHY (STE-568). A documentation audit of v2.80.3 found sixteen drifts under
// `plugins/dev-process-toolkit/docs/`. These are reference documents an
// operator or an author follows AS INSTRUCTIONS, so a stale one costs a wrong
// action rather than a moment's confusion — and every one of them was accurate
// when it was written. Fixing the sixteen sentences is necessary and closes
// nothing: the next sixteen arrive the same way.
//
// Two of the sixteen are whole CLASSES, and those get readers here:
//
//  1. RETIRED SHAPES still taught as current — the monolithic `specs/plan.md`
//     and the `{fr_anchor}` / `requirements.md#FR-N` back-link, both replaced
//     by the file-per-FR layout. Five sites and two sites respectively; a
//     per-site correction cannot see the eighth.
//  2. CITED PATHS that no longer resolve. Two spec citations sat at their
//     pre-archive paths and one named a test file that has never existed.
//     `/gate-check` probe #23 (`traceability-link-validity`) does not scan
//     `docs/`, which is why this class was unguarded here.
//
// Both readers scan the LIVE tree rather than a fixture: the assertion being
// made is about the shipped documents, and a fixture would only prove that the
// matcher compiles.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

export interface DocsSweepViolation {
  /** Path relative to the docs directory, POSIX separators. */
  file: string;
  line: number;
  rule: "retired_shape" | "citation_unresolved" | "citation_moved";
  /** The offending token exactly as the doc spells it. */
  token: string;
  reason: string;
}

/** Every `*.md` under `docsDir`, recursively, as repo-relative POSIX paths. */
export function listDocs(docsDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const abs = join(dir, entry);
      if (statSync(abs).isDirectory()) walk(abs);
      else if (entry.endsWith(".md")) out.push(relative(docsDir, abs).split(sep).join("/"));
    }
  };
  if (existsSync(docsDir)) walk(docsDir);
  return out;
}

// ---------------------------------------------------------------------------
// (1) Retired shapes
// ---------------------------------------------------------------------------

/**
 * A shape the toolkit retired, and the form that replaced it.
 *
 * `exemptWhen` is deliberately narrow. A doc is allowed to NAME a retired
 * shape when it is explaining that the shape is retired — that sentence is the
 * opposite of the drift, and forbidding it would push the fix toward deleting
 * the explanation. Requiring the word on the same line means anyone
 * reintroducing the token has to label it, which is exactly the decision this
 * rule wants forced into the open.
 */
export interface RetiredShape {
  token: string;
  replacement: string;
  exemptWhen: RegExp;
}

export const RETIRED_SHAPES: readonly RetiredShape[] = [
  {
    // The monolithic plan, replaced by per-milestone `specs/plan/<M#>.md`.
    // Matched with a trailing boundary so `specs/plan/M12.md` does not hit.
    token: "specs/plan.md",
    replacement: "specs/plan/<M#>.md",
    exemptWhen: /retired|legacy|monolith/i,
  },
  {
    // The SAME retirement, in the spelling the finding actually took. Two of
    // the five drifted sites wrote the backticked bare name ("lead reads
    // `plan.md`", "start with just `plan.md`") rather than the full path, so a
    // sweep keyed only on `specs/plan.md` would have reported those two clean.
    token: "`plan.md`",
    replacement: "`specs/plan/<M#>.md`",
    exemptWhen: /retired|legacy|monolith|replaces/i,
  },
  {
    // The pre-file-per-FR back-link, replaced by `specs/frs/{tracker_id}.md`.
    token: "{fr_anchor}",
    replacement: "specs/frs/{tracker_id}.md",
    exemptWhen: /retired|legacy/i,
  },
  {
    token: "specs/requirements.md#FR-",
    replacement: "specs/frs/{tracker_id}.md",
    exemptWhen: /retired|legacy/i,
  },
];

export function sweepRetiredShapes(docsDir: string): DocsSweepViolation[] {
  const out: DocsSweepViolation[] = [];
  for (const rel of listDocs(docsDir)) {
    const lines = readFileSync(join(docsDir, rel), "utf-8").split("\n");
    for (const [idx, line] of lines.entries()) {
      for (const shape of RETIRED_SHAPES) {
        if (!line.includes(shape.token)) continue;
        // The exemption reads a small WINDOW, not one line: these docs wrap at
        // ~76 columns, so the sentence that says "retired" routinely sits on
        // the line above or below the token it is about.
        const window = lines.slice(Math.max(0, idx - 2), idx + 3).join(" ");
        if (shape.exemptWhen.test(window)) continue;
        out.push({
          file: rel,
          line: idx + 1,
          rule: "retired_shape",
          token: shape.token,
          reason: `teaches the retired \`${shape.token}\` shape as current; the shipped form is \`${shape.replacement}\``,
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// (2) Cited paths
// ---------------------------------------------------------------------------

/**
 * Paths a doc cites, of the two kinds this repo actually gets wrong: a spec
 * under `specs/frs/` or `specs/plan/`, and a test file under `tests/`.
 *
 * `<...>` placeholders are excluded by the character class: `specs/plan/<M#>.md`
 * describes a SHAPE and there is nothing to resolve.
 */
const CITATION_RE =
  /(?:specs\/(?:frs|plan)(?:\/archive)?\/[.A-Za-z0-9_][A-Za-z0-9_.-]*\.md|tests\/[.A-Za-z0-9_][A-Za-z0-9_.-]*\.test\.ts)/g;

/**
 * Paths `/setup` SCAFFOLDS into a consumer's tree, which are therefore not
 * citations into this repository at all.
 *
 * A doc naming one of these is telling the reader what their own project will
 * contain after `/setup` runs. That this repository happens to hold an
 * `specs/plan/archive/M1.md` — because its own first milestone shipped and was
 * archived years of releases ago — is a coincidence of its history, not a
 * broken pointer, and resolving it "helpfully" to the archive would be the
 * checker misreading the sentence. `tests/.placeholder.test.ts` is the same
 * case: `/setup` writes it into a consumer repo so an empty test directory has
 * something to run.
 *
 * Kept as an explicit, short, commented list rather than as a heuristic on the
 * surrounding prose — a heuristic here would silence real findings invisibly.
 */
export const CONSUMER_SCAFFOLD_PATHS: readonly string[] = [
  "specs/plan/M1.md",
  "tests/.placeholder.test.ts",
];

/** Where a basename actually lives, searched across the two roots. */
function locate(repoRoot: string, pluginRoot: string, basename: string): string[] {
  const hits: string[] = [];
  const roots: Array<[string, string]> = [
    [join(repoRoot, "specs", "frs"), "specs/frs"],
    [join(repoRoot, "specs", "frs", "archive"), "specs/frs/archive"],
    [join(repoRoot, "specs", "plan"), "specs/plan"],
    [join(repoRoot, "specs", "plan", "archive"), "specs/plan/archive"],
    [join(pluginRoot, "tests"), "tests"],
  ];
  for (const [abs, rel] of roots) {
    if (existsSync(join(abs, basename))) hits.push(`${rel}/${basename}`);
  }
  return hits;
}

/**
 * Report every cited spec or test path that does not resolve as written.
 *
 * Resolution is AS WRITTEN and never through `--follow`: a citation that only
 * resolves by chasing a rename is still a citation a reader cannot chase,
 * which is the thing being fixed. When the basename is found elsewhere the
 * violation names WHERE, because "the file moved to the archive" is the
 * overwhelmingly common cause and the remedy should not require a search.
 */
export function sweepCitations(
  docsDir: string,
  repoRoot: string,
  pluginRoot: string,
): DocsSweepViolation[] {
  const out: DocsSweepViolation[] = [];
  for (const rel of listDocs(docsDir)) {
    for (const [idx, line] of readFileSync(join(docsDir, rel), "utf-8")
      .split("\n")
      .entries()) {
      for (const m of line.matchAll(CITATION_RE)) {
        const cited = m[0];
        if (CONSUMER_SCAFFOLD_PATHS.includes(cited)) continue;
        const abs = cited.startsWith("tests/")
          ? join(pluginRoot, cited)
          : join(repoRoot, cited);
        if (existsSync(abs)) continue;
        const basename = cited.slice(cited.lastIndexOf("/") + 1);
        const elsewhere = locate(repoRoot, pluginRoot, basename);
        out.push({
          file: rel,
          line: idx + 1,
          rule: elsewhere.length > 0 ? "citation_moved" : "citation_unresolved",
          token: cited,
          reason:
            elsewhere.length > 0
              ? `cites \`${cited}\`, which is now at ${elsewhere.join(" / ")}`
              : `cites \`${cited}\`, which is not on disk at that path or any other`,
        });
      }
    }
  }
  return out;
}

// ensureCanonicalLayout — STE-69 seeding helper for the Diátaxis `docs/`
// tree. Called by `/docs --full` and `/docs --commit` when the tree is
// missing. Idempotent: safe to call on a partial or fully-populated tree;
// only fills gaps, never overwrites.
//
// Seed layout (AC-STE-69.1):
//
//     docs/
//     ├── README.md                        (seed from docs-README.md.template)
//     ├── tutorials/
//     │   └── getting-started.md           (seed from docs-getting-started.md.template)
//     ├── how-to/
//     │   └── .gitkeep
//     ├── reference/
//     │   └── .gitkeep                     (when packagesMode=false)
//     │   OR
//     │   └── api/.gitkeep                 (when packagesMode=true — AC-STE-69.1/.4)
//     ├── explanation/
//     │   └── architecture.md              (seed from docs-architecture.md.template)
//     └── .pending/
//         └── .gitkeep                     (AC-STE-69.6 — tracked in git)
//
// `.gitkeep` files are plain empty files that keep otherwise-empty
// directories tracked in git. They get displaced automatically when the
// first real content lands in the directory (we check only "empty" at
// creation time; housekeeping on content arrival is the caller's job).
//
// Template substitution is minimal: `{{project}}` resolves to the basename
// of `projectRoot`. Heavier templating (current date, tracker mode, etc.)
// lands when /docs content generation (STE-70) needs it.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { DocsConfig } from "./docs_config";

export type { DocsConfig } from "./docs_config";

export interface LayoutReport {
  /** Relative paths (from projectRoot) of files/dirs newly created. */
  created: string[];
  /** Relative paths of files/dirs that were already present. */
  existing: string[];
  /** Non-fatal notes — e.g., unexpected files under docs/. */
  warnings: string[];
}

type Action =
  | { kind: "dir"; path: string }
  | { kind: "file"; path: string; contentFromTemplate?: string; contentLiteral?: string };

function render(template: string, projectRoot: string): string {
  return template.replace(/\{\{project\}\}/g, basename(projectRoot));
}

/**
 * Ensure the Diátaxis-shaped `docs/` tree exists under `projectRoot`.
 * Idempotent: never overwrites existing files. Returns a report listing
 * what was created vs. already present so callers can decide whether to
 * surface the result to the user.
 *
 * @param projectRoot Absolute path to the project root.
 * @param config Parsed docs modes (from readDocsConfig).
 * @param templatesDir Absolute path to the plugin's `templates/` dir.
 *   Tests pass their own; production callers pass `${CLAUDE_PLUGIN_ROOT}/templates`.
 */
export function ensureCanonicalLayout(
  projectRoot: string,
  config: DocsConfig,
  templatesDir: string,
): LayoutReport {
  const report: LayoutReport = { created: [], existing: [], warnings: [] };

  const readmeTemplate = readFileSync(join(templatesDir, "docs-README.md.template"), "utf8");
  const architectureTemplate = readFileSync(
    join(templatesDir, "docs-architecture.md.template"),
    "utf8",
  );
  const gettingStartedTemplate = readFileSync(
    join(templatesDir, "docs-getting-started.md.template"),
    "utf8",
  );

  const actions: Action[] = [
    { kind: "dir", path: "docs" },
    { kind: "dir", path: "docs/tutorials" },
    { kind: "dir", path: "docs/how-to" },
    { kind: "dir", path: "docs/reference" },
    { kind: "dir", path: "docs/explanation" },
    { kind: "dir", path: "docs/.pending" },
    { kind: "file", path: "docs/README.md", contentFromTemplate: render(readmeTemplate, projectRoot) },
    {
      kind: "file",
      path: "docs/tutorials/getting-started.md",
      contentFromTemplate: render(gettingStartedTemplate, projectRoot),
    },
    {
      kind: "file",
      path: "docs/explanation/architecture.md",
      contentFromTemplate: render(architectureTemplate, projectRoot),
    },
    { kind: "file", path: "docs/how-to/.gitkeep", contentLiteral: "" },
    { kind: "file", path: "docs/.pending/.gitkeep", contentLiteral: "" },
  ];

  if (config.packagesMode) {
    actions.push({ kind: "dir", path: "docs/reference/api" });
    actions.push({ kind: "file", path: "docs/reference/api/.gitkeep", contentLiteral: "" });
  } else {
    actions.push({ kind: "file", path: "docs/reference/.gitkeep", contentLiteral: "" });
  }

  for (const action of actions) {
    const abs = join(projectRoot, action.path);
    if (action.kind === "dir") {
      if (existsSync(abs)) {
        report.existing.push(action.path);
      } else {
        mkdirSync(abs, { recursive: true });
        report.created.push(action.path);
      }
      continue;
    }
    if (existsSync(abs)) {
      report.existing.push(action.path);
      continue;
    }
    const content = action.contentFromTemplate ?? action.contentLiteral ?? "";
    writeFileSync(abs, content);
    report.created.push(action.path);
  }

  return report;
}

// claudemd_docs_section — /gate-check probe (STE-107 AC-STE-107.4).
//
// If CLAUDE.md exists, it MUST contain a `## Docs` section as a real
// (non-commented) `##`-level heading. Sibling probe to existing
// `## Task Tracking` checks. Catches the silent feature-drop failure mode
// from the v1.29.0 smoke test (F4).
//
// SCOPE (STE-432 AC-STE-432.2): the probe only runs on toolkit-managed trees,
// decided by the shared predicate in `./toolkit_managed.ts`. A hand-written
// `CLAUDE.md` the toolkit never bootstrapped is out of scope — the old guard was
// `existsSync(CLAUDE.md)`, which made this an error-severity gate failure on any
// project that authored its own file, with a remedy telling the operator to
// paste toolkit content into a file the toolkit does not own.
//
// The `ignore: ["docs_section"]` carve-out is load-bearing: accepting `## Docs`
// as the evidence that a tree is managed, inside the probe that ASSERTS `## Docs`
// is present, is circular — it would make the probe vacuous on exactly the trees
// it exists to catch.
//
// HTML comments are stripped before the heading scan on the ASSERTION side — a
// `## Docs` line nested inside `<!-- … -->` does not count. (Detection reads the
// raw body; see `toolkit_managed.ts`.)
//
// BOTH SIDES MUST AGREE ON WHAT A HEADING IS. Apart from the comment strip, the
// assertion below normalizes and matches exactly like `toolkit_managed.ts`'s
// `docs_section` detector. It previously did not: detection normalized BOM+CRLF
// and matched `^##\s+Docs\s*$`, while the assertion read the RAW body and matched
// `^## Docs\s*$` (one literal space). A tree with `##  Docs` or a BOM-prefixed
// first-line heading therefore cleared the managed-ness guard and then FAILED the
// assertion despite genuinely having the section — an error-severity false
// positive, the exact failure class M118 exists to eliminate.

import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { isToolkitManaged } from "./toolkit_managed";

const HEADING_LINE = "## Docs";

export interface ClaudeMdDocsSectionViolation {
  file: string;
  line: number;
  reason: string;
  note: string;
  message: string;
}

export interface ClaudeMdDocsSectionReport {
  violations: ClaudeMdDocsSectionViolation[];
}

function stripHtmlComments(s: string): string {
  return s.replace(/<!--[\s\S]*?-->/g, "");
}

/**
 * Strip a leading UTF-8 BOM and fold CRLF (and lone CR) to LF.
 *
 * MUST STAY IN STEP with `normalize()` in `./toolkit_managed.ts`. It is
 * duplicated rather than imported on purpose: `toolkit_managed.ts` has a closed
 * export contract (AC-STE-432.1 enumerates its exports) and widening it for one
 * private helper was explicitly rejected. If that normalization changes, change
 * this one too — the two sides diverging is the asymmetry this fixes.
 */
function normalize(body: string): string {
  const withoutBom = body.charCodeAt(0) === 0xfeff ? body.slice(1) : body;
  return withoutBom.replace(/\r\n?/g, "\n");
}

export async function runClaudeMdDocsSectionProbe(
  projectRoot: string,
): Promise<ClaudeMdDocsSectionReport> {
  if (!isToolkitManaged(projectRoot, { ignore: ["docs_section"] })) {
    return { violations: [] };
  }

  const claudeMd = join(projectRoot, "CLAUDE.md");
  const raw = readFileSync(claudeMd, "utf-8");
  // Normalize first (so `^`/`$` anchor the same way they do on the detection
  // side), then strip comments — the strip MUST stay ahead of the heading test,
  // or a commented-out `## Docs` would satisfy the contract.
  const stripped = stripHtmlComments(normalize(raw));

  // The canonical Schema-D heading, matched with `toolkit_managed.ts`'s
  // `docs_section` pattern byte for byte — anchored, so `## Documentation` is
  // still not a match.
  if (/^##\s+Docs\s*$/m.test(stripped)) return { violations: [] };

  const rel = relative(projectRoot, claudeMd);
  const reason = `${HEADING_LINE} section missing — /docs cannot read mode flags without it`;
  const note = `${rel}:1 — ${reason}`;
  const message = [
    `claudemd_docs_section: ${reason}`,
    `Remedy: append a ${HEADING_LINE} section to ${rel} with the canonical keys (user_facing_mode, packages_mode, changelog_ci_owned), all defaulting to false. ` +
      `See plugins/dev-process-toolkit/templates/CLAUDE.md.template for the canonical block shape.`,
    `Context: file=${rel}, probe=claudemd_docs_section`,
  ].join("\n");

  return {
    violations: [{ file: claudeMd, line: 1, reason, note, message }],
  };
}

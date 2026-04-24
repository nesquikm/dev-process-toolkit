// validateNavContract — STE-69 parser + validator for the `docs/README.md`
// top-level nav contract (AC-STE-69.2, AC-STE-69.5, AC-STE-69.8).
//
// Contract: the README must contain exactly four `##`-level headings,
// each carrying one of the canonical `{#anchor}` attributes —
// `tutorials`, `how-to`, `reference`, `explanation`. Under each heading,
// a relative markdown link must point to an existing file or directory.
// Mode invariance: the nav contract is the same for packages-only,
// user-facing-only, and mixed-mode repos (only the `reference/` content
// differs between modes — the top-level skeleton does not).
//
// Consumers (AC-STE-69.8):
//   - `/gate-check` probe #12 (STE-69 AC-STE-69.5) — fails the gate with
//     an NFR-10 canonical-shape remedy.
//   - `/docs --commit` (STE-70) — refuses to commit against a broken tree.
//
// Both consumers treat `ok: false` as a hard failure; this module only
// owns parsing + assertion, not error rendering.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { readDocsConfig } from "./docs_config";

export interface ExtraHeading {
  title: string;
  /** 1-indexed line number of the `## ...` line in docs/README.md. */
  line: number;
}

export type ValidationResult =
  | { ok: true }
  | {
      ok: false;
      reason: string;
      missingAnchors?: string[];
      brokenLinks?: string[];
      extraHeadings?: ExtraHeading[];
    };

export const CANONICAL_ANCHORS = ["tutorials", "how-to", "reference", "explanation"] as const;
export type CanonicalAnchor = (typeof CANONICAL_ANCHORS)[number];

interface ParsedHeading {
  /** 1-indexed line number of the `## ...` line. */
  line: number;
  /** Raw heading text without the `##` prefix or `{#anchor}` attribute. */
  title: string;
  /** `{#anchor}` attribute value if present, else null. */
  anchor: string | null;
  /** All `[text](link)` targets encountered until the next heading. */
  links: string[];
}

const LINK_RE = /\[[^\]]*\]\(([^)]+)\)/g;

function parseHeadings(markdown: string): ParsedHeading[] {
  const lines = markdown.split("\n");
  const headings: ParsedHeading[] = [];
  let current: ParsedHeading | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const h2Match = /^##\s+(.*)$/.exec(line);
    if (h2Match) {
      if (current) headings.push(current);
      const raw = h2Match[1]!.trim();
      const anchorMatch = /\{#([a-z0-9-]+)\}\s*$/.exec(raw);
      const title = anchorMatch ? raw.slice(0, anchorMatch.index).trim() : raw;
      const anchor = anchorMatch ? anchorMatch[1]! : null;
      current = { line: i + 1, title, anchor, links: [] };
      continue;
    }
    if (/^#\s/.test(line)) continue; // H1 is fine, not tracked.
    if (current) {
      LINK_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = LINK_RE.exec(line)) !== null) {
        current.links.push(m[1]!);
      }
    }
  }
  if (current) headings.push(current);
  return headings;
}

/**
 * Validate the README at `docsReadmePath` against the STE-69 nav
 * contract. Non-throwing: a missing file is an `ok: false` result, not
 * an exception.
 */
export function validateNavContract(docsReadmePath: string): ValidationResult {
  if (!existsSync(docsReadmePath)) {
    return {
      ok: false,
      reason: `docs/README.md not found at ${docsReadmePath}`,
    };
  }

  const markdown = readFileSync(docsReadmePath, "utf8");
  const headings = parseHeadings(markdown);

  const missingAnchors: string[] = [];
  const brokenLinks: string[] = [];
  const extraHeadings: ExtraHeading[] = [];

  const anchorToHeading = new Map<string, ParsedHeading>();
  for (const h of headings) {
    if (h.anchor && (CANONICAL_ANCHORS as readonly string[]).includes(h.anchor)) {
      anchorToHeading.set(h.anchor, h);
    } else {
      extraHeadings.push({ title: h.title, line: h.line });
    }
  }

  for (const anchor of CANONICAL_ANCHORS) {
    const heading = anchorToHeading.get(anchor);
    if (!heading) {
      missingAnchors.push(anchor);
      continue;
    }
    if (heading.links.length === 0) {
      brokenLinks.push(`${anchor}: no link in section`);
      continue;
    }
    for (const link of heading.links) {
      const abs = join(dirname(docsReadmePath), link);
      if (!existsSync(abs)) {
        brokenLinks.push(`${anchor} → ${link}`);
      }
    }
  }

  if (missingAnchors.length === 0 && brokenLinks.length === 0 && extraHeadings.length === 0) {
    return { ok: true };
  }

  const reasonParts: string[] = [];
  if (missingAnchors.length) reasonParts.push(`missing anchors: ${missingAnchors.join(", ")}`);
  if (extraHeadings.length)
    reasonParts.push(
      `extra ##-level heading(s): ${extraHeadings.map((e) => e.title).join(", ")}`,
    );
  if (brokenLinks.length) reasonParts.push(`broken links: ${brokenLinks.join("; ")}`);

  return {
    ok: false,
    reason: reasonParts.join(" | "),
    ...(missingAnchors.length ? { missingAnchors } : {}),
    ...(extraHeadings.length ? { extraHeadings } : {}),
    ...(brokenLinks.length ? { brokenLinks } : {}),
  };
}

export interface ProbeNote {
  /** Relative path (from projectRoot) of the offending file. */
  file: string;
  /** 1-indexed line number, or 1 when the offence is file-level. */
  line: number;
  /** Short reason describing what's wrong. */
  reason: string;
}

export interface ProbeResult {
  /** True when the probe did not fire (no notes). */
  ok: boolean;
  /** Empty when ok; one note per distinct violation otherwise. */
  notes: ProbeNote[];
  /** True when the probe was skipped (no docs modes enabled). */
  skipped: boolean;
}

/**
 * Gate-check probe #12 integration (STE-69 AC-STE-69.5, AC-STE-69.9).
 * Skips when `readDocsConfig` reports both mode flags false (docs
 * generation disabled — no contract to enforce). Otherwise runs
 * `validateNavContract` on `docs/README.md` and emits one note per
 * violation in the `file:line — reason` shape used by all
 * `/gate-check` probes.
 */
export function runNavContractProbe(projectRoot: string): ProbeResult {
  const claudeMdPath = join(projectRoot, "CLAUDE.md");
  const config = readDocsConfig(claudeMdPath);
  const anyMode = config.userFacingMode || config.packagesMode;
  if (!anyMode) {
    return { ok: true, notes: [], skipped: true };
  }

  const readmePath = join(projectRoot, "docs", "README.md");
  const result = validateNavContract(readmePath);
  if (result.ok) {
    return { ok: true, notes: [], skipped: false };
  }

  const notes: ProbeNote[] = [];
  const readmeRel = "docs/README.md";

  if (result.missingAnchors) {
    for (const anchor of result.missingAnchors) {
      notes.push({
        file: readmeRel,
        line: 1,
        reason: `missing canonical anchor {#${anchor}}`,
      });
    }
  }
  if (result.extraHeadings) {
    for (const { title, line } of result.extraHeadings) {
      notes.push({
        file: readmeRel,
        line,
        reason: `extra ##-level heading "${title}" (only the four canonical anchors are permitted)`,
      });
    }
  }
  if (result.brokenLinks) {
    for (const link of result.brokenLinks) {
      notes.push({
        file: readmeRel,
        line: 1,
        reason: `broken link — ${link}`,
      });
    }
  }

  // Guarantee at least one note when ok is false — covers the
  // README-not-found case where validateNavContract returns a reason
  // without anchor/heading/link detail.
  if (notes.length === 0) {
    notes.push({ file: readmeRel, line: 1, reason: result.reason });
  }

  return { ok: false, notes, skipped: false };
}

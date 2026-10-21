// bug_fr_shape (STE-680) — probe #88: every active `kind: bug` FR carries the
// bug FR body (docs/resolver-entry.md § "Bug FR body").
//
//   * SHAPE arm — one violation per missing piece of each active bug FR:
//     `### Steps to reproduce`, `### Expected` and `### Actual` present and not
//     TODO-only; `### Root cause` present and not TODO-only, with the STE-227
//     needs-technical-review placeholder satisfying it on an FR flagged
//     `needs_technical_review: true`; at least one AC under
//     `## Acceptance Criteria` whose body begins `Regression:` followed by
//     something other than nothing or a TODO marker. Each subsection is graded
//     under its own `##` parent (STE-681); fenced code is never structure.
//   * COHERENCE arm — a `kind: bug` FR's `changelog_category` is `Fixed` or
//     `Security`; `bug` is the only recognised `kind:` value.
//
// Active means a file directly under `specs/frs/` — `specs/frs/archive/` is
// never graded. An FR with no `kind: bug` is never graded.
//
// Read-only: no git, no network, no child processes.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { normalizeFrontmatterSource, parseFrontmatter, splitFrontmatter } from "./frontmatter";

/** The probe id, as registered in `skills/gate-check/SKILL.md`. */
export const PROBE_ID = "bug_fr_shape";

const FRS_SEGMENTS = ["specs", "frs"] as const;

export interface BugFrShapeViolation {
  readonly file: string;
  readonly line: number;
  readonly reason: string;
  /** `<file>:<line> — <reason>`. */
  readonly note: string;
  /** NFR-10 shape: verdict line, `Remedy:`, `Context:`. */
  readonly message: string;
  readonly severity: "error";
}

export interface BugFrShapeReport {
  readonly violations: BugFrShapeViolation[];
  readonly notes: string[];
  /** MEASURED: no active FR carries `kind: bug`. */
  readonly vacuous: boolean;
}

function readText(abs: string): string | undefined {
  try {
    return readFileSync(abs, "utf-8");
  } catch {
    return undefined;
  }
}

function violation(file: string, line: number, reason: string, remedy: string): BugFrShapeViolation {
  const note = `${file}:${line} — ${reason}`;
  return {
    file,
    line,
    reason,
    note,
    severity: "error",
    message: [
      `${PROBE_ID}: ${note}`,
      `Remedy: ${remedy}`,
      `Context: file=${file}, line=${line}, probe=${PROBE_ID}, severity=error`,
    ].join("\n"),
  };
}

const HEADING_RE = /^(#{1,6})\s+(.*?)\s*$/;
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;

/**
 * The lines with every line inside a ``` / ~~~ fence replaced by a neutral,
 * non-blank filler: a `# comment` or a quoted `### Expected` / AC line in a
 * code block is not structure, but the block still fills its section. Line
 * numbers are kept.
 */
function maskFences(lines: readonly string[]): string[] {
  let open: string | undefined;
  return lines.map((l) => {
    const m = FENCE_RE.exec(l);
    if (open === undefined) {
      if (m) open = m[1]!;
      return l;
    }
    if (m && m[1]![0] === open[0] && m[1]!.length >= open.length && l.trim() === m[1]) {
      open = undefined;
      return l;
    }
    return "(fenced)";
  });
}

interface Section {
  /** 1-based line of the heading. */
  readonly line: number;
  readonly body: string[];
}

/**
 * The `#`-level heading named `title` (case-insensitive), with its body up to
 * the next heading of level `stopLevel` or shallower. The default stops at any
 * heading; `stopLevel: 2` keeps a `##` section's `###` subsections.
 */
function findSection(lines: readonly string[], level: number, title: string, stopLevel = 6): Section | undefined {
  const want = title.toLowerCase();
  for (let i = 0; i < lines.length; i++) {
    const m = HEADING_RE.exec(lines[i]!);
    if (!m || m[1]!.length !== level || m[2]!.toLowerCase() !== want) continue;
    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const h = HEADING_RE.exec(lines[j]!);
      if (h && h[1]!.length <= stopLevel) break;
      body.push(lines[j]!);
    }
    return { line: i + 1, body };
  }
  return undefined;
}

/** Everything under a `## ` heading, through its `###` subsections, up to the next `#`/`##`. */
function findTopSection(lines: readonly string[], title: string): Section | undefined {
  return findSection(lines, 2, title, 2);
}

const TODO_LINE = /^\s*(?:[-*]\s+|\d+\.\s+)?TODO\b/i;

/** A section is filled when it has a non-blank line that is not a TODO marker. */
function isFilled(body: readonly string[]): boolean {
  return body.some((l) => l.trim() !== "" && !TODO_LINE.test(l));
}

const NTR_PLACEHOLDER_RE = /\[needs technical review — run \/spec-write \S+ to complete\]/;
const AC_LINE_RE = /^\s*[-*]\s+AC-[^:\s]+:\s*(.*)$/;

const OBSERVABLE: readonly { readonly title: string; readonly what: string }[] = [
  { title: "Steps to reproduce", what: "the numbered steps from a clean state" },
  { title: "Expected", what: "what should happen" },
  { title: "Actual", what: "what happens instead" },
];

interface PlacedSubsection extends Section {
  /** Title of the `##` section the subsection sits under, or `(none)`. */
  readonly parent: string;
}

/** Every `### <title>` subsection (case-insensitive), each with the `##` section it sits under. */
function findSubsections(lines: readonly string[], title: string): PlacedSubsection[] {
  const want = title.toLowerCase();
  const out: PlacedSubsection[] = [];
  let parent = "(none)";
  for (let i = 0; i < lines.length; i++) {
    const m = HEADING_RE.exec(lines[i]!);
    if (!m) continue;
    const level = m[1]!.length;
    if (level <= 2) {
      parent = level === 2 ? m[2]! : "(none)";
      continue;
    }
    if (level !== 3 || m[2]!.toLowerCase() !== want) continue;
    const body: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (HEADING_RE.test(lines[j]!)) break;
      body.push(lines[j]!);
    }
    out.push({ line: i + 1, body, parent });
  }
  return out;
}

function gradeBugFr(rel: string, lines: readonly string[], fm: Record<string, unknown>): BugFrShapeViolation[] {
  const out: BugFrShapeViolation[] = [];
  const anchor = (title: string): number => findTopSection(lines, title)?.line ?? 1;
  // Flags every `### <title>` sitting outside `## <home>`; returns the first one
  // in place, and whether any were misplaced (the "missing" verdict then yields).
  const place = (title: string, home: string): { sec: PlacedSubsection | undefined; misplaced: boolean } => {
    const all = findSubsections(lines, title);
    const stray = all.filter((s) => s.parent.toLowerCase() !== home.toLowerCase());
    for (const s of stray) {
      out.push(
        violation(
          rel,
          s.line,
          `the bug FR's \`### ${title}\` subsection is misplaced under ## ${s.parent} — it belongs under ## ${home}`,
          `move \`### ${title}\` under ## ${home}`,
        ),
      );
    }
    return { sec: all.find((s) => s.parent.toLowerCase() === home.toLowerCase()), misplaced: stray.length > 0 };
  };

  for (const piece of OBSERVABLE) {
    const { sec, misplaced } = place(piece.title, "Requirement");
    if (sec === undefined) {
      if (misplaced) continue;
      out.push(
        violation(
          rel,
          anchor("Requirement"),
          `the bug FR has no \`### ${piece.title}\` subsection under ## Requirement`,
          `add \`### ${piece.title}\` under ## Requirement with ${piece.what} (/spec-write --bug)`,
        ),
      );
    } else if (!isFilled(sec.body)) {
      out.push(
        violation(
          rel,
          sec.line,
          `the bug FR's \`### ${piece.title}\` subsection is empty or TODO-only`,
          `fill \`### ${piece.title}\` with ${piece.what}`,
        ),
      );
    }
  }

  const { sec: rootCause, misplaced: rootMisplaced } = place("Root cause", "Technical Design");
  // The placeholder is not a root cause: it satisfies the piece only on a flagged FR.
  const written = rootCause !== undefined && isFilled(rootCause.body.filter((l) => !NTR_PLACEHOLDER_RE.test(l)));
  if (!written && !(rootCause === undefined && rootMisplaced)) {
    const flagged = fm["needs_technical_review"] === true;
    const tech = findTopSection(lines, "Technical Design");
    const placeholder = tech !== undefined && tech.body.some((l) => NTR_PLACEHOLDER_RE.test(l));
    if (!(flagged && placeholder)) {
      out.push(
        violation(
          rel,
          rootCause?.line ?? anchor("Technical Design"),
          rootCause === undefined
            ? "the bug FR has no `### Root cause` subsection under ## Technical Design"
            : "the bug FR's `### Root cause` subsection is empty or TODO-only",
          "write `### Root cause` under ## Technical Design (file:line, the faulty assumption), " +
            "or mark the FR `needs_technical_review: true` with the needs-technical-review placeholder line",
        ),
      );
    }
  }

  const hasRegression = (findTopSection(lines, "Acceptance Criteria")?.body ?? []).some((l) => {
    const m = AC_LINE_RE.exec(l);
    // An empty or TODO-only `Regression:` body (the import's appended stub) does not count.
    return m !== null && m[1]!.startsWith("Regression:") && isFilled([m[1]!.slice("Regression:".length)]);
  });
  if (!hasRegression) {
    out.push(
      violation(
        rel,
        anchor("Acceptance Criteria"),
        "the bug FR has no Regression criterion — no AC body begins `Regression:` with a filled, non-TODO body",
        "add an AC whose body begins `Regression:` naming the test that fails before the fix and passes after it",
      ),
    );
  }
  return out;
}

const BUG_CATEGORIES: readonly string[] = ["Fixed", "Security"];

/**
 * 1-based line of the frontmatter key `key:`, or 1 when absent. `splitFrontmatter`
 * tolerates CRLF / lone-CR / BOM, and its `lines` start on document line 2.
 */
function frontmatterKeyLine(text: string, key: string): number {
  const split = splitFrontmatter(text);
  if (split === null) return 1;
  const re = new RegExp(`^${key}\\s*:`);
  const i = split.lines.findIndex((l) => re.test(l));
  return i === -1 ? 1 : i + 2;
}

function gradeCoherence(rel: string, text: string, fm: Record<string, unknown>): BugFrShapeViolation[] {
  const kind = String(fm["kind"]);
  if (kind !== "bug") {
    return [
      violation(
        rel,
        frontmatterKeyLine(text, "kind"),
        `the FR carries \`kind: ${kind}\` — \`bug\` is the only recognised kind`,
        "set `kind: bug` for a bug FR, or remove the `kind:` key for any other FR",
      ),
    ];
  }
  const category = fm["changelog_category"];
  if (typeof category === "string" && BUG_CATEGORIES.includes(category)) return [];
  const shown = category === undefined || category === null ? "(absent)" : String(category);
  return [
    violation(
      rel,
      category === undefined ? frontmatterKeyLine(text, "kind") : frontmatterKeyLine(text, "changelog_category"),
      `the bug FR's changelog_category is ${shown} — a \`kind: bug\` FR must be Fixed or Security`,
      "set `changelog_category: Fixed` (or `Security` for a vulnerability fix)",
    ),
  ];
}

export function runBugFrShapeProbe(projectRoot: string): BugFrShapeReport {
  const frsDir = join(projectRoot, ...FRS_SEGMENTS);
  let names: string[];
  try {
    names = readdirSync(frsDir).filter((n) => n.endsWith(".md")).sort();
  } catch {
    names = [];
  }
  const violations: BugFrShapeViolation[] = [];
  let graded = 0;
  for (const name of names) {
    const abs = join(frsDir, name);
    try {
      if (!statSync(abs).isFile()) continue;
    } catch {
      continue;
    }
    const raw = readText(abs);
    if (raw === undefined) continue;
    // Fold CRLF / lone CR / BOM once so every line anchor below sees LF lines.
    const text = normalizeFrontmatterSource(raw);
    let fm: Record<string, unknown>;
    try {
      fm = parseFrontmatter(text);
    } catch {
      continue;
    }
    if (!("kind" in fm) || fm["kind"] === undefined) continue;
    const rel = [...FRS_SEGMENTS, name].join("/");
    violations.push(...gradeCoherence(rel, text, fm));
    if (fm["kind"] !== "bug") continue;
    graded++;
    violations.push(...gradeBugFr(rel, maskFences(text.split("\n")), fm));
  }
  return { violations, notes: violations.map((v) => v.note), vacuous: graded === 0 };
}

// Read-only CLI front door; inert on import.
if (import.meta.main) {
  const projectRoot = process.argv[2] || process.cwd();
  const report = runBugFrShapeProbe(projectRoot);
  if (report.violations.length > 0) {
    console.log(report.violations.map((v) => v.message).join("\n\n"));
    process.exit(1);
  }
}

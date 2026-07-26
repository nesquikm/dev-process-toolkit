// requires_input_sentinel_coverage (STE-232 AC-STE-232.5) — /gate-check probe.
// Severity: error.
//
// Globs `plugins/dev-process-toolkit/skills/*/SKILL.md` and
// `.claude/skills/*/SKILL.md` (matching STE-226 AC.5). For every skill whose
// body DECLARES a `requires-input:` gate, asserts:
//
//   (a) the body invokes the canonical helper `requireOrRefuse(...)`
//       (substring match on `requireOrRefuse`)
//   (b) the body cites the canonical protocol doc `docs/auto-mode-protocol.md`
//       by relative path (substring match on the path literal)
//
// Either missing ⇒ one violation per check. Both missing on the same skill ⇒
// two separate violations so the operator sees both gaps in the gate-check
// report. Skills without a `requires-input:` annotation are vacuously out of
// scope — the protocol only constrains gates that explicitly declare the
// requirement.
//
// SCOPE IS PER OCCURRENCE, NOT PER FILE. A skill is in scope only when some
// non-comment line DECLARES a gate; a line that merely REFERS to the
// convention in running prose does not pull the citing skill in. The two are
// separated by `isRequiresInputDeclaration(line)` below, which is the single
// source of truth for the distinction. Rationale: the disclaimer "the marker
// is read but never relaxes a `requires-input:` gate" is prose the protocol
// doc itself asks marker-consuming skills to carry, and several such skills
// legitimately have no gate of their own.
//
// AUTHORING NOTE for anyone editing prose that DESCRIBES this rule (the
// /gate-check probe catalogue entry, or this module's own examples): keep any
// illustrative annotation OUT of a leading position and OUT of a reason-bearing
// inline-code span, or the describing skill declares a gate and scopes itself
// in. Run candidate prose through `isRequiresInputDeclaration` before
// committing it.
//
// HTML-comment-scoped mentions are stripped before scanning so a skill that
// documents the convention in a comment is never in scope. Fenced code blocks
// are NOT stripped — example helper calls inside a fence count toward (a), and
// protocol-doc citations inside a fence count toward (b).

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export type Severity = "error" | "warning";

export interface RequiresInputCoverageViolation {
  file: string;
  line: number;
  reason: string;
  note: string;
  message: string;
  severity: Severity;
}

export interface RequiresInputCoverageReport {
  violations: RequiresInputCoverageViolation[];
}

const HELPER_TOKEN = "requireOrRefuse";
const PROTOCOL_PATH = "docs/auto-mode-protocol.md";
const REQUIRES_INPUT_TOKEN = "requires-input:";

/**
 * Markdown decoration that may legally sit in front of a gate declaration
 * without turning it into running prose: indentation, blockquote markers,
 * table-cell pipes, ATX heading markers, bullet / ordered-list markers, and
 * emphasis runs. Applied repeatedly so nested decoration (`> - **`) is peeled.
 * Anything else — a real word — means the token is being cited inside a
 * sentence rather than declared.
 */
const DECORATION_RE =
  /^(?:[ \t]+|>|\||#{1,6}[ \t]+|[-*+][ \t]+|\d+[.)][ \t]+|\*\*|__|\*|_)/;

/** Placeholder reason (`<reason>`) — used only for anchor selection. */
const PLACEHOLDER_REASON_RE = /^<[^>]*>$/;

/** Peel cap — see `stripLeadingDecoration`. Real nesting is 2-3 deep. */
const MAX_DECORATION_DEPTH = 32;

function buildMessage(
  file: string,
  line: number,
  kind: "helper" | "protocol",
): string {
  if (kind === "helper") {
    return [
      `requires_input_sentinel_coverage: ${file}:${line} — skill carries a ` +
        `\`requires-input:\` annotation but the body does not reference the ` +
        `canonical helper \`${HELPER_TOKEN}\` from ` +
        `\`adapters/_shared/src/requires_input.ts\`.`,
      `Remedy: route the per-step refusal through ` +
        `\`${HELPER_TOKEN}(spec, key, sentinel)\` so the four-outcome decision ` +
        `(user-supplied / pre-baked / default-applied / refused) is consolidated. ` +
        `See \`docs/auto-mode-protocol.md\` § Refusal Mechanism.`,
      `Context: file=${file}, probe=requires_input_sentinel_coverage, severity=error`,
    ].join("\n");
  }
  return [
    `requires_input_sentinel_coverage: ${file}:${line} — skill carries a ` +
      `\`requires-input:\` annotation but the body does not cite the canonical ` +
      `protocol doc \`${PROTOCOL_PATH}\`.`,
    `Remedy: include a relative-path reference to \`${PROTOCOL_PATH}\` near the ` +
      `\`requires-input:\` annotation so a future reader (and the probe) can ` +
      `trace the cross-skill contract.`,
    `Context: file=${file}, probe=requires_input_sentinel_coverage, severity=error`,
  ].join("\n");
}

/**
 * Strip HTML comments (`<!-- ... -->`) from a markdown body before scanning.
 * Comments are documentation surface, not live behavior; a `requires-input:`
 * mention inside a comment doesn't impose the contract on the surrounding
 * skill.
 */
function stripHtmlComments(content: string): string {
  return content.replace(/<!--[\s\S]*?-->/g, "");
}

/**
 * Peel leading markdown decoration. Total: every string returns a string,
 * never throws. Terminates because each pass strictly shortens the input.
 */
function stripLeadingDecoration(line: string): string {
  let s = line;
  // Bounded: real decoration nests a handful deep (`> - **`). Each pass costs
  // O(remaining), and the single-char alternatives peel one char at a time, so
  // an unbounded loop is quadratic on a pathological leading run (a garbled
  // table row of thousands of `|` measured ~105ms at 100k chars). The cap
  // keeps a hostile line cheap; no legitimate declaration approaches it.
  for (let i = 0; i < MAX_DECORATION_DEPTH; i++) {
    const next = s.replace(DECORATION_RE, "");
    if (next === s) return s;
    s = next;
  }
  return s;
}

/**
 * Clause 1 — line ownership. After decoration is peeled (and one optional
 * opening backtick), the annotation is the next thing on the line. A
 * declaration is what the line is ABOUT; a prose reference always has
 * narrative text in front of it.
 */
function ownsLine(line: string): boolean {
  const bare = stripLeadingDecoration(line);
  const inner = bare.startsWith("`") ? bare.slice(1) : bare;
  return inner.startsWith(REQUIRES_INPUT_TOKEN);
}

/**
 * Clause 2 — reason-bearing inline-code span. An annotation written mid-line
 * still declares a gate when it supplies its reason:
 * `` `requires-input: no safe default exists` ``. A span holding the bare
 * token and nothing else is a citation of the convention, not a declaration.
 *
 * The span regex is function-local on purpose: a module-level `/g` regex
 * carries `lastIndex` state across calls and is a re-entrancy footgun.
 */
function hasReasonBearingSpan(line: string): boolean {
  const spanRe = /`([^`\n]*)`/g;
  let m: RegExpExecArray | null;
  while ((m = spanRe.exec(line)) !== null) {
    const inner = m[1]!;
    if (!inner.startsWith(REQUIRES_INPUT_TOKEN)) continue;
    if (inner.slice(REQUIRES_INPUT_TOKEN.length).trim().length > 0) return true;
  }
  return false;
}

/**
 * SINGLE SOURCE OF TRUTH — does this line DECLARE a `requires-input:` gate
 * (in scope) rather than REFER to the contract in running prose (out of
 * scope)? Total: every string input returns a boolean, never throws.
 *
 *   clause 1  the annotation owns its line, after list / heading / emphasis /
 *             blockquote / table-cell decoration and one optional backtick
 *   clause 2  an inline-code span carries the annotation AND a reason
 *
 * Sibling idiom: `isNegativeAssertion(...)` in `plan_verify_line_validity.ts`.
 * Future declaration SHAPES are added here, never via ad-hoc match logic at a
 * call site.
 */
export function isRequiresInputDeclaration(line: string): boolean {
  if (!line.includes(REQUIRES_INPUT_TOKEN)) return false;
  if (ownsLine(line)) return true;
  return hasReasonBearingSpan(line);
}

/**
 * Anchor preference only — NEVER affects scope. True when the line declares a
 * gate carrying a concrete reason (not the bare token, not the `<reason>`
 * template placeholder), so a violation points at the real gate rather than at
 * a convention-documenting bullet that happens to appear earlier in the file.
 */
function declaresConcreteReason(line: string): boolean {
  if (!isRequiresInputDeclaration(line)) return false;
  const spanRe = /`([^`\n]*)`/g;
  let m: RegExpExecArray | null;
  while ((m = spanRe.exec(line)) !== null) {
    const inner = m[1]!;
    if (!inner.startsWith(REQUIRES_INPUT_TOKEN)) continue;
    const reason = inner.slice(REQUIRES_INPUT_TOKEN.length).trim();
    if (reason.length > 0 && !PLACEHOLDER_REASON_RE.test(reason)) return true;
  }
  const bare = stripLeadingDecoration(line);
  if (bare.startsWith(REQUIRES_INPUT_TOKEN)) {
    const reason = bare.slice(REQUIRES_INPUT_TOKEN.length).trim();
    if (reason.length > 0 && !PLACEHOLDER_REASON_RE.test(reason)) return true;
  }
  return false;
}

/**
 * 1-based line the violations anchor to, or `null` when the body declares no
 * gate (=> the skill is vacuously out of scope). Prefers the first declaration
 * carrying a concrete reason; falls back to the first declaration of any shape.
 * Exported so meta-tests can enumerate the in-scope set without
 * re-implementing the rule.
 */
export function findRequiresInputDeclarationLine(
  content: string,
): number | null {
  const lines = stripHtmlComments(content).split("\n");
  let firstDeclaration: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!isRequiresInputDeclaration(line)) continue;
    if (firstDeclaration === null) firstDeclaration = i + 1;
    if (declaresConcreteReason(line)) return i + 1;
  }
  return firstDeclaration;
}

function scanSkillFile(
  absPath: string,
  projectRoot: string,
): RequiresInputCoverageViolation[] {
  if (!existsSync(absPath)) return [];
  let content: string;
  try {
    content = readFileSync(absPath, "utf-8");
  } catch {
    return [];
  }
  const annotationLine = findRequiresInputDeclarationLine(content);
  if (annotationLine === null) return [];
  const stripped = stripHtmlComments(content);
  const rel = relative(projectRoot, absPath);
  const violations: RequiresInputCoverageViolation[] = [];
  if (!stripped.includes(HELPER_TOKEN)) {
    const reason = `requires-input: annotation present but no \`${HELPER_TOKEN}\` call cited`;
    violations.push({
      file: absPath,
      line: annotationLine,
      reason,
      note: `${rel}:${annotationLine} — ${reason}`,
      message: buildMessage(rel, annotationLine, "helper"),
      severity: "error",
    });
  }
  if (!stripped.includes(PROTOCOL_PATH)) {
    const reason = `requires-input: annotation present but \`${PROTOCOL_PATH}\` not cited`;
    violations.push({
      file: absPath,
      line: annotationLine,
      reason,
      note: `${rel}:${annotationLine} — ${reason}`,
      message: buildMessage(rel, annotationLine, "protocol"),
      severity: "error",
    });
  }
  return violations;
}

function listSkillFiles(skillsDir: string): string[] {
  if (!existsSync(skillsDir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(skillsDir);
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const name of entries) {
    const dir = join(skillsDir, name);
    let s;
    try {
      s = statSync(dir);
    } catch {
      continue;
    }
    if (!s.isDirectory()) continue;
    const skillMd = join(dir, "SKILL.md");
    if (existsSync(skillMd)) files.push(skillMd);
  }
  return files;
}

export async function runRequiresInputSentinelCoverageProbe(
  projectRoot: string,
): Promise<RequiresInputCoverageReport> {
  const pluginSkillsDir = join(
    projectRoot,
    "plugins",
    "dev-process-toolkit",
    "skills",
  );
  const projectSkillsDir = join(projectRoot, ".claude", "skills");
  const violations: RequiresInputCoverageViolation[] = [];
  for (const f of listSkillFiles(pluginSkillsDir)) {
    violations.push(...scanSkillFile(f, projectRoot));
  }
  for (const f of listSkillFiles(projectSkillsDir)) {
    violations.push(...scanSkillFile(f, projectRoot));
  }
  return { violations };
}

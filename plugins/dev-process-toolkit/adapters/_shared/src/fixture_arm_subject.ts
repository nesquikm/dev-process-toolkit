// fixture_arm_subject — STE-564. A fixture arm asserts its probe's SUBJECT,
// never a rendering of it.
//
// WHY, MEASURED. STE-532/533 standardised how `/gate-check` renders a probe
// row. Every smoke fixture arm keyed to the old bold-row shape stopped
// matching on the same day, and not one of them went red: group 2's `**#26 ` /
// `**Probe #26 ` and group 9's `**#13 ` / `**✗ Probe #13 ` / `**#73 ` /
// `**✗ Probe #73 ` occur ZERO times across five 2026-09-05 captures, while
// every one of those probes fired and reported file, line, expectation and
// actual. What failed is the assertion, not the subject. Fourth occurrence of
// the class.
//
// THE SWEEP IS DERIVED, NOT ENUMERATED. Listing the six known arms is the
// shape that let these six survive a standardisation aimed at the surface they
// read — and the sibling FR in this milestone was itself first written with an
// enumerated list that was wrong by four. This walks every `capability_row_assert`
// invocation in both harness SKILLs and grades what it finds.
//
// IT GRADES ARMS, NOT PROSE. Group 2's and group 9's paragraphs QUOTE the
// retired shapes while explaining why they were retired, and a sweep that
// could not tell an argument from an assertion would forbid writing the
// explanation down. Only the inline-code span that INVOKES the asserter is
// read; the sentence after it is not.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { HARNESS_SKILL_RELATIVE_PATHS } from "./harness_artifact_paths";

/** Repo root, derived from this file's own location. */
const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..", "..");

export const PROBE_ID = "fixture_arm_subject";

/**
 * Row decorations: how `/gate-check` DRAWS a probe row, as opposed to what the
 * probe is called.
 *
 * Each is a thing the runtime chose and can restyle. `**` is the bold row
 * marker STE-488 borrowed as a delimiter; `✗` and `⚠` are per-severity glyphs;
 * a bare `#<digits>` is the row's ordinal, which moves whenever a probe is
 * registered ahead of it.
 */
export const ROW_DECORATIONS: readonly { pattern: RegExp; name: string }[] = [
  { pattern: /\*\*/, name: "bold row marker `**`" },
  { pattern: /✗|⚠|✓/, name: "severity glyph" },
  { pattern: /#\d+/, name: "bare probe ordinal `#<n>`" },
];

export interface FixtureArmViolation {
  file: string;
  line: number;
  /** The offending arm, verbatim. */
  arm: string;
  /** Which decoration it carries. */
  decoration: string;
  reason: string;
  note: string;
  message: string;
  severity: "error";
}

/** One `capability_row_assert` invocation found in a SKILL body. */
export interface FixtureArmInvocation {
  line: number;
  expectation: string;
  /** The keys the invocation scores, in order. */
  arms: string[];
}

/**
 * The inline-code spans on one line, in either markdown fence width.
 *
 * Double-backtick spans come first: an arm that must carry a rendered backtick
 * is written in a ``…`` span, and matching the single form first would slice
 * it in half.
 */
function inlineCodeSpans(line: string): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(/``([^`]|`[^`])*``/g)) out.push(m[0].slice(2, -2));
  const withoutDouble = line.replace(/``([^`]|`[^`])*``/g, " ");
  for (const m of withoutDouble.matchAll(/`[^`]+`/g)) out.push(m[0].slice(1, -1));
  return out;
}

/**
 * Split an invocation span into its expectation and its arms.
 *
 * The shape is `bun "${CAP_ASSERT}" <expectation> <capture-path> <key…>`. The
 * capture path is identified by being the first token after the expectation;
 * everything after it is an arm. Quoted arms keep their spaces, which is how a
 * decorated arm such as `"**#26 "` stays ONE arm rather than two tokens.
 */
export function parseInvocation(span: string, line: number): FixtureArmInvocation | null {
  if (!span.includes("CAP_ASSERT") && !span.includes("capability_row_assert")) return null;
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const m of span.matchAll(re)) {
    tokens.push(m[1] ?? m[2] ?? m[3]!);
  }
  // Drop everything up to and including the asserter reference.
  const at = tokens.findIndex((t) => t.includes("CAP_ASSERT") || t.includes("capability_row_assert"));
  if (at < 0) return null;
  const rest = tokens.slice(at + 1);
  if (rest.length < 3) return null;
  const [expectation, , ...arms] = rest;
  return { line, expectation: expectation!, arms };
}

/** Every asserter invocation in a SKILL body, in document order. */
export function enumerateInvocations(skillBody: string): FixtureArmInvocation[] {
  const out: FixtureArmInvocation[] = [];
  skillBody.split("\n").forEach((raw, index) => {
    for (const span of inlineCodeSpans(raw)) {
      const parsed = parseInvocation(span, index + 1);
      if (parsed !== null) out.push(parsed);
    }
  });
  return out;
}

function buildMessage(file: string, line: number, arm: string, decoration: string): string {
  return (
    `Refusing: ${file}:${line} — fixture arm ${JSON.stringify(arm)} keys on a ${decoration}, not on its probe's identity.\n` +
    `Remedy: name the probe itself and score it with an \`-token\` expectation (\`any-of-token\` / \`present-token\` / \`absent-token\`), which supplies the delimiter the decoration was borrowed for. List both rendered id spellings as separate arms, per fixture 3c.\n` +
    `Context: probe=${PROBE_ID}, severity=error, file=${file}, line=${line}`
  );
}

/**
 * Every fixture arm keying on a row decoration.
 *
 * Vacuous — zero violations, no throw — when the harness SKILLs are absent, so
 * a consumer project never fails on this.
 */
export function scanFixtureArmSubjects(
  repoRoot: string = REPO_ROOT,
  skillRelativePaths: readonly string[] = HARNESS_SKILL_RELATIVE_PATHS,
): FixtureArmViolation[] {
  const violations: FixtureArmViolation[] = [];
  for (const rel of skillRelativePaths) {
    let body: string;
    try {
      body = readFileSync(join(repoRoot, rel), "utf8");
    } catch {
      continue;
    }
    for (const invocation of enumerateInvocations(body)) {
      for (const arm of invocation.arms) {
        const hit = ROW_DECORATIONS.find((d) => d.pattern.test(arm));
        if (hit === undefined) continue;
        const reason = `fixture arm ${JSON.stringify(arm)} keys on a ${hit.name}`;
        violations.push({
          file: rel,
          line: invocation.line,
          arm,
          decoration: hit.name,
          reason,
          note: `${rel}:${invocation.line} — ${reason}`,
          message: buildMessage(rel, invocation.line, arm, hit.name),
          severity: "error",
        });
      }
    }
  }
  return violations;
}

if (import.meta.main) {
  const violations = scanFixtureArmSubjects();
  for (const v of violations) process.stderr.write(`${v.note}\n`);
  process.stdout.write(
    violations.length === 0
      ? "fixture-arm-subject: ok violations=0\n"
      : `fixture-arm-subject: FAIL violations=${violations.length}\n`,
  );
  process.exit(violations.length === 0 ? 0 : 1);
}

// STE-657 — a milestone plan carries a validated codename composed at spec time.
//
// validateCodename is the single rule set every codename passes: non-empty
// after trimming, at most CODENAME_MAX characters, no backtick, no line break.

import { readFileSync } from "node:fs";
import { nfr10Message } from "./dpt_version";
import { parseFrontmatter } from "./frontmatter";

export const CODENAME_MAX = 32;

/** The rule set in remedy prose — shared by every refusal that names it. */
export const CODENAME_RULES = `1-${CODENAME_MAX} characters with no backtick and no line break`;

export type CodenameResult = { ok: true; value: string } | { ok: false; reason: string };

/** Validate a codename. Returns the trimmed value, or a reason naming the broken rule. */
export function validateCodename(value: string): CodenameResult {
  const trimmed = value.trim();
  if (trimmed === "") {
    return { ok: false, reason: "codename is empty (it must contain at least one non-whitespace character)" };
  }
  // Checked on the untrimmed value: trimming would quietly swallow a trailing
  // line break, and a break anywhere is refused, not repaired.
  if (/[\r\n]/.test(value)) {
    return { ok: false, reason: "codename contains a line break (\\n or \\r is not allowed)" };
  }
  if (trimmed.includes("`")) {
    return { ok: false, reason: "codename contains a backtick (` is not allowed)" };
  }
  if (trimmed.length > CODENAME_MAX) {
    return {
      ok: false,
      reason: `codename is ${trimmed.length} characters; the limit is ${CODENAME_MAX}`,
    };
  }
  return { ok: true, value: trimmed };
}

/**
 * Read the `codename:` frontmatter value of a plan file (AC-STE-657.2).
 * Returns the validated value, or `null` when the key is absent or the literal
 * `null`. Throws an NFR-10 error naming the plan path and the broken rule when
 * the value fails validateCodename.
 */
export function readPlanCodename(planPath: string): string | null {
  const text = readFileSync(planPath, "utf8");
  const fm = parseFrontmatter(text);
  if (!("codename" in fm)) return null;
  const raw = fm.codename;
  if (raw === null || raw === undefined) return null;
  const quoted = isQuotedCodenameLine(text);
  const value = quoted ? unquoteWithComment(String(raw)) : stripInlineComment(String(raw));
  // Only a BARE `null` (comment tail stripped) is the template sentinel; a
  // quoted "null" is a codename someone chose.
  if (!quoted && value === "null") return null;
  const r = validateCodename(value);
  if (r.ok) return r.value;
  throw new Error(
    nfr10Message(
      `milestone_codename: ${planPath} carries an invalid codename — ${r.reason}`,
      `edit the codename: line in ${planPath} to a value of ${CODENAME_RULES}, or set it to null`,
      `file=${planPath}, rule=${r.reason}, probe=milestone_codename`,
    ),
  );
}

/**
 * A YAML inline comment (whitespace, then `#` to end of line) is not part of an
 * unquoted scalar — the plan template ships `codename: null  # …`, and it must
 * read as null. Mirrors readFrontmatterField in migrations/coverage.ts.
 */
function stripInlineComment(value: string): string {
  return value.replace(/\s+#.*$/, "").trim();
}

/**
 * The shared parser unquotes a value only when the quote closes the line, so
 * `"Foo" # c` arrives still quoted: drop the comment after the closing quote and
 * unquote it the way the parser would (JSON for `"…"`, `''` folding for `'…'`).
 */
function unquoteWithComment(value: string): string {
  const dq = /^"((?:[^"\\]|\\.)*)"\s+#.*$/.exec(value);
  if (dq) {
    try {
      return JSON.parse(`"${dq[1]}"`) as string;
    } catch {
      return dq[1]!;
    }
  }
  const sq = /^'((?:[^']|'')*)'\s+#.*$/.exec(value);
  if (sq) return sq[1]!.replace(/''/g, "'");
  return value;
}

/** Whether the frontmatter's `codename:` value is a quoted scalar, where `#` is data. */
function isQuotedCodenameLine(text: string): boolean {
  const line = text.split("\n").find((l) => /^codename\s*:/.test(l)) ?? "";
  return /^codename\s*:\s*["']/.test(line);
}

// Front door (AC-STE-657.3): `bun run milestone_codename.ts <planPath>` prints
// exactly one stdout line — `codename=<value>` or `codename=absent` — and exits
// 0. An invalid value prints the NFR-10 envelope on stderr, nothing on stdout,
// and exits 1. `--check <value>` prints the same line shape for a codename no
// plan holds yet, with the same refusal. Inert on import (`import.meta.main` is false).
if (import.meta.main) {
  // `--check <value>`: validate a codename that is not in any plan yet, so a
  // skill composing one checks it before the plan file is written.
  if (process.argv[2] === "--check") {
    const r = validateCodename(process.argv[3] ?? "");
    if (!r.ok) {
      console.error(
        nfr10Message(
          `milestone_codename: the composed codename is invalid — ${r.reason}`,
          `compose a value of ${CODENAME_RULES} and check it again`,
          `rule=${r.reason}, probe=milestone_codename`,
        ),
      );
      process.exit(1);
    }
    console.log(`codename=${r.value}`);
    process.exit(0);
  }
  const planPath = process.argv[2];
  if (!planPath) {
    console.error(
      nfr10Message(
        "milestone_codename: no plan path given",
        "run: bun run adapters/_shared/src/milestone_codename.ts <planPath>",
        "probe=milestone_codename",
      ),
    );
    process.exit(1);
  }
  try {
    const value = readPlanCodename(planPath);
    console.log(`codename=${value ?? "absent"}`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}

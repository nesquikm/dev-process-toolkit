// scrub_secrets — STE-229 AC-STE-229.6.
//
// Pure, deterministic redaction pass. No I/O, no side effects. Used by
// /report-issue before any payload is uploaded to a gist.
//
// Patterns are applied in the documented order below. The Anthropic
// pattern runs before OpenAI so a `sk-ant-…` key is attributed to
// `anthropic_api_key` rather than `openai_api_key` (longest-prefix-first
// — the safety note from the FR).

export interface SecretPattern {
  /** Stable identifier surfaced in the per-skill match-count summary. */
  key: string;
  /** Regular expression matching the secret literal. Global flag set. */
  pattern: RegExp;
  /**
   * Replacement string. When `undefined`, the match is replaced with the
   * literal `***REDACTED***`. When defined, the string can use `$1` etc.
   * to preserve a captured group (e.g., the key name in
   * `api_key=***REDACTED***`).
   */
  replacement?: string;
}

const REDACTED = "***REDACTED***";

/**
 * Seven canonical secret patterns. Order is load-bearing: Anthropic
 * before OpenAI prevents `sk-ant-…` keys being mis-attributed to OpenAI.
 */
export const SECRET_PATTERNS: readonly SecretPattern[] = [
  {
    key: "anthropic_api_key",
    pattern: /sk-ant-[A-Za-z0-9_-]{20,}/g,
  },
  {
    // Matches both legacy `sk-<48 alphanumeric>` and v2 project keys
    // `sk-proj-<base64-ish with - / _>`. Hyphens and underscores are
    // included in the char class so a `sk-proj-…` key (whose body
    // segments are separated by hyphens) does not truncate at 4 chars
    // and slip through unredacted. The Anthropic pattern runs first
    // (longest-prefix-first) so `sk-ant-…` keys are still attributed
    // to `anthropic_api_key`, not OpenAI.
    key: "openai_api_key",
    pattern: /sk-[A-Za-z0-9_-]{20,}/g,
  },
  {
    key: "github_pat",
    pattern: /gh[pous]_[A-Za-z0-9]{20,}/g,
  },
  {
    key: "aws_access_key",
    pattern: /AKIA[0-9A-Z]{16}/g,
  },
  {
    key: "generic_key_value",
    pattern:
      /(api[_-]?key|token|password|secret)\s*[:=]\s*['"]?[^\s'"]{8,}/gi,
    replacement: `$1=${REDACTED}`,
  },
  {
    key: "jwt",
    pattern: /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  },
  {
    key: "aws_secret_key",
    pattern:
      /(aws[_-]?secret[_-]?access[_-]?key)\s*[:=]\s*['"]?[A-Za-z0-9/+=]{40}/gi,
    replacement: `$1=${REDACTED}`,
  },
];

export interface ScrubMatch {
  pattern: string;
  count: number;
}

export interface ScrubResult {
  scrubbed: string;
  matches: ScrubMatch[];
}

/**
 * Apply every pattern in `SECRET_PATTERNS` to `text`. Returns the
 * scrubbed string plus a per-pattern match count (zero counts included
 * so the consumer can render an exhaustive summary).
 *
 * Idempotent: running twice on already-scrubbed text returns the same
 * scrubbed string with all-zero match counts. The redaction sentinel
 * `***REDACTED***` does not match any of the patterns.
 */
export function scrubSecrets(text: string): ScrubResult {
  let working = text;
  const matches: ScrubMatch[] = [];
  for (const entry of SECRET_PATTERNS) {
    // RegExp.match returns the array of literal matches when the pattern
    // is global; we count once before replace so the count reflects the
    // pre-redaction occurrence count rather than the (zero) post count.
    const found = working.match(entry.pattern);
    const count = found ? found.length : 0;
    if (count > 0) {
      working = working.replace(entry.pattern, entry.replacement ?? REDACTED);
    }
    matches.push({ pattern: entry.key, count });
  }
  return { scrubbed: working, matches };
}

// format_description — STE-211 helpers (AC-STE-211.1..7).
//
// Linear's MCP server post-processes issue descriptions on save: bare
// `STE-NNN` tokens get auto-linked into `<issue id="...">STE-NNN</issue>`
// XML wrappers. The toolkit's `AC-<TKR>-NN.N` prefix shape (e.g.,
// `AC-STE-203.1`) contains a literal `STE-203` substring that the auto-
// linker matches even though the surrounding `AC-` prefix and `.N`
// suffix make it unambiguously not a bare issue reference.
//
// Two helpers, exact inverses on the AC-prefix shape:
//
//   formatLinearDescription(body) — wrap AC prefixes in inline-code
//     fences (`` AC-`STE-NNN`.N ``) before pushing to Linear. The
//     fences are a documented markdown escape that disables auto-linking.
//
//   stripLinearACFences(body) — strip both newly-pushed fences AND
//     legacy `<issue id>` XML wrappers when matched against the AC-prefix
//     shape. Round-trip property: `strip(format(x)) === x`.
//
// Targeted scope: bare issue references in prose (e.g., `Refs: STE-205`)
// keep their auto-linking — the helpers only touch tokens preceded by
// `AC-` and followed by `.<digits>` (the AC-prefix shape).

const AC_PLAIN_RE = /\bAC-([A-Z]+-\d+)(\.\d+)\b/g;
const AC_BACKTICK_RE = /\bAC-`([A-Z]+-\d+)`(\.\d+)\b/g;
const AC_LINEAR_XML_RE = /\bAC-<issue id="[^"]*">([A-Z]+-\d+)<\/issue>(\.\d+)\b/g;

/**
 * STE-211 AC-STE-211.1 / AC-STE-211.2: wrap AC prefixes in inline-code
 * fences before pushing the body to Linear. Linear-adapter scoped —
 * Jira / custom adapters that do not auto-link `STE-NNN` tokens should
 * not call this helper (the wrap would be cosmetic noise).
 *
 * Idempotent: applying twice produces identical output. The regex
 * matches only `AC-<UPPER>-<digits>.<digits>` shapes that are NOT
 * already followed by a backtick (the post-state of a previous call).
 */
export function formatLinearDescription(body: string): string {
  return body.replace(AC_PLAIN_RE, "AC-`$1`$2");
}

/**
 * STE-211 AC-STE-211.3 / AC-STE-211.4: strip Linear-side AC-prefix
 * wrappers back to plain text on import. Two passes:
 *   (1) backtick-wrapped form (newly-pushed FRs after STE-211 ships);
 *   (2) `<issue id="...">...</issue>` XML form (legacy pre-fix
 *       descriptions that got auto-linker-mangled).
 *
 * The XML strip is targeted: only matches when the wrapper is preceded
 * by `AC-` and followed by `.<digits>`. Bare issue references (e.g.,
 * `Refs: STE-205`) keep their `<issue id>` wrapper untouched.
 */
export function stripLinearACFences(body: string): string {
  let s = body.replace(AC_BACKTICK_RE, "AC-$1$2");
  s = s.replace(AC_LINEAR_XML_RE, "AC-$1$2");
  return s;
}

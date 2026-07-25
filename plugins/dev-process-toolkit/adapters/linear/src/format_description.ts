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
// STE-398: Linear's MCP now emits an `href` attribute alongside `id`
// (`<issue id="…" href="…">`). The pattern accepts any attribute set after
// `issue` — `<issue\s[^>]*>` requires ≥ 1 attribute and cannot cross the
// closing `>`, so it stays inside the single tag — while the `\bAC-` prefix
// and `(\.\d+)` suffix keep the match scoped to AC prefixes (bare issue
// references like `Refs: STE-205` are untouched).
const AC_LINEAR_XML_RE =
  /\bAC-<issue\s[^>]*>([A-Z]+-\d+)<\/issue>(\.\d+)\b/g;

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

// --- AC task-list checkbox emission (push side) -----------------------------

/** `## Acceptance Criteria` heading, tolerating internal whitespace variance. */
const AC_HEADING_RE = /^##\s+Acceptance\s+Criteria\s*$/;
/** Section terminator — same boundary rule as `normalize` (H1..H3). */
const SECTION_BREAK_RE = /^#{1,3}\s/;
/**
 * A bullet that already carries task-list syntax; its state is load-bearing.
 *
 * Capture groups mirror `normalize`'s pull-side checkbox pattern exactly —
 * `(indent, state, text)` over `\[\s*(x|X|\s)\s*\]` rather than the tighter
 * `\[[ xX]\]` — so push and pull agree on what counts as "already a box" AND
 * on the canonical form they rewrite it to. A slack form like `- [x ] foo`
 * that missed this predicate would fall through to `PLAIN_BULLET_RE` and get
 * a second box prefixed onto it (`- [ ] [x ] foo`), nesting the markup and
 * dropping the checked state; one that merely *matched* and was skipped would
 * survive as literal text, since GFM requires exactly one character between
 * the brackets for a task-list marker. Hence: match wide, then canonicalize.
 */
const EXISTING_CHECKBOX_RE = /^(\s*)[-*]\s*\[\s*([xX\s])\s*\]\s*(.*)$/;
/** A plain bullet (`- text` / `* text`); the marker is canonicalized to `-`. */
const PLAIN_BULLET_RE = /^(\s*)[-*][ \t]+(.*)$/;

/**
 * Emit every acceptance criterion as a markdown task-list checkbox so Linear
 * renders a native, togglable box — the surface `pull_acs` reads and
 * `push_ac_toggle` flips. Applied on the create / upsert composition
 * alongside `formatLinearDescription`.
 *
 * Scope: only lines inside the `## Acceptance Criteria` section, which ends
 * at the next `#`..`###` heading. A plain bullet becomes `- [ ] <text>`; an
 * existing box is canonicalized to GFM task-list syntax with its state
 * preserved (`- [x ]` → `- [x]`, `- [  ]` → `- [ ]`, `- [x]` unchanged — the
 * state is never reset), because GFM requires exactly one character between
 * the brackets and a slack box would otherwise render as literal text with no
 * togglable checkbox. Every other byte — prose inside the section, bullets in
 * other sections, a body with no AC section at all — is returned untouched.
 *
 * Whole-body transform, NOT a section extractor: unlike `normalize`, a body
 * without an AC section comes back byte-identical rather than empty.
 *
 * Line endings: CRLF is folded to LF before scanning, matching `normalize`'s
 * "Step 1: CRLF -> LF" — the line predicates below end in `(.*)$` with no `m`
 * flag, so a `\r`-terminated line matches neither and the whole transform
 * would silently degrade to a no-op on a CRLF-sourced description. Folding is
 * a consequence of transforming, never something done to a body left alone:
 * the `start === -1` branch hands back the ORIGINAL `body`, `\r`s and all, so
 * a description this helper declines to touch is never rewritten.
 *
 * Idempotent (`f(f(x)) === f(x)`) and commutes with
 * `formatLinearDescription` — the checkbox is a line prefix, the fences wrap
 * the AC-ID token, so the two never touch the same bytes.
 *
 * Linear-adapter scoped: Jira / custom adapters do not call this helper.
 */
export function checkboxifyLinearACs(body: string): string {
  const lines = body.replace(/\r\n/g, "\n").split("\n");

  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (AC_HEADING_RE.test((lines[i] ?? "").trim())) {
      start = i + 1;
      break;
    }
  }
  // No AC section — nothing to transform, so nothing to normalize either:
  // return the ORIGINAL bytes, not the LF view computed for the scan.
  if (start === -1) return body;

  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (SECTION_BREAK_RE.test((lines[i] ?? "").trim())) {
      end = i;
      break;
    }
  }

  const out = lines.slice();
  for (let i = start; i < end; i++) {
    const line = out[i] ?? "";
    const box = line.match(EXISTING_CHECKBOX_RE);
    if (box) {
      // Already a box: canonicalize to GFM (`- [x] ` / `- [ ] `) with the
      // toggle state preserved. Canonical lines re-emit byte-identically.
      const state = (box[2] ?? " ").toLowerCase() === "x" ? "x" : " ";
      out[i] = `${box[1] ?? ""}- [${state}] ${(box[3] ?? "").trim()}`;
      continue;
    }
    const m = line.match(PLAIN_BULLET_RE);
    if (!m) continue; // Prose, blank lines, and non-bullets are untouched.
    out[i] = `${m[1] ?? ""}- [ ] ${m[2] ?? ""}`;
  }
  return out.join("\n");
}

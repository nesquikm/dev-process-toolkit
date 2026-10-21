// Shared source-reading helpers for the M_292387 / STE-686 suites.
//
// The pins in those suites read the shipped TypeScript as TEXT: they find one
// function's body (or one call's argument list) and ask which numeric values a
// `timeout:` option can reach from there — through a literal, a `const`, or a
// one-line helper function — so a bound moved behind a named constant still
// pins, while a bound that is simply absent does not.

/** `src` with `//` line comments and `/* *\/` block comments blanked out. */
export function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (_m, lead: string) => lead);
}

/**
 * The body of the top-level `function <name>(` in `src`, from the declaration
 * to the first line that is exactly `}` — this codebase closes every top-level
 * function at column 0. `null` when there is no such function.
 */
export function functionBody(src: string, name: string): string | null {
  const re = new RegExp(`(?:^|\\n)(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*[(<]`);
  const m = re.exec(src);
  if (m === null) return null;
  const start = m.index;
  const end = src.indexOf("\n}\n", start);
  return end === -1 ? src.slice(start) : src.slice(start, end + 2);
}

/**
 * The argument text of the call that contains `src[at]`: scans backwards to the
 * opening `(` of the enclosing call and forwards to its balanced `)`.
 */
export function enclosingCall(src: string, at: number): string {
  let depth = 0;
  let open = -1;
  for (let i = at; i >= 0; i--) {
    const c = src[i];
    if (c === ")" || c === "]" || c === "}") depth++;
    else if (c === "(" || c === "[" || c === "{") {
      if (depth === 0 && c === "(") {
        open = i;
        break;
      }
      if (depth > 0) depth--;
    }
  }
  if (open === -1) return src.slice(at, at + 400);
  depth = 0;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return src.slice(open);
}

/** The expression text of every `timeout:` option in `text`. */
export function timeoutExpressions(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\btimeout\s*:\s*([^,\n}]+)/g)) out.push(m[1]!.trim());
  return out;
}

const KEYWORDS = new Set([
  "const", "let", "var", "return", "if", "else", "function", "new", "typeof", "undefined", "null",
  "true", "false", "Number", "process", "env", "isFinite", "parseInt", "Math", "round",
]);

/**
 * Every numeric value reachable from `expr`: its literals, plus — up to
 * `depth` hops — the literals of any `const` or top-level function it names.
 */
export function reachableNumbers(expr: string, src: string, depth = 3): number[] {
  const nums = new Set<number>();
  for (const m of expr.matchAll(/(?<![\w$.])(\d[\d_]*)(?![\w$])/g)) nums.add(Number(m[1]!.replaceAll("_", "")));
  if (depth <= 0) return [...nums];
  for (const m of expr.matchAll(/[A-Za-z_$][\w$]*/g)) {
    const id = m[0];
    if (KEYWORDS.has(id)) continue;
    const decl = new RegExp(`\\bconst\\s+${id}\\b[^=]*=\\s*([^;\\n]+)`).exec(src);
    if (decl) for (const n of reachableNumbers(decl[1]!, src, depth - 1)) nums.add(n);
    const fn = functionBody(src, id);
    if (fn) for (const n of reachableNumbers(fn, src, depth - 1)) nums.add(n);
  }
  return [...nums];
}

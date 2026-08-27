// skip_identities — WHO is skipping, read out of the runner's own
// machine-readable report (AC-STE-529.1).
//
// The skip ratchet has always compared a NUMBER. A number cannot tell a removed
// skip from an added one, so a change that silences one test while un-silencing
// another reads as a clean pass. This module supplies the missing half: the
// identities of the skipped tests at a given observation.
//
// TWO PROPERTIES ARE LOAD-BEARING.
//
//   1. ONE RUN, BOTH SIGNALS. `skipIdentityCommand` composes the runner
//      invocation that writes a machine-readable report AND still prints the
//      stdout summary the shipped count parser reads. For the bun stack that is
//      `bun test --reporter=junit --reporter-outfile=<path>`: the junit document
//      goes to the file, the human summary still goes to the console. If naming
//      the skips cost a second run, every caller would have to choose between a
//      count and an identity, and the cheap one would win.
//
//   2. THE PATH IS THE CALLER'S (AC-STE-529.10). Both the command composer and
//      the extractor take the report path as a REQUIRED argument and compose
//      none of their own — no default, no fallback location, no knowledge of
//      where the toolkit keeps its artifacts. A second composer of that path
//      agrees with the caller right up until the caller moves it, and then
//      diverges silently. Path composition belongs to the one module that owns
//      it (M104 / AC-STE-382.1), and this module deliberately does not import
//      it.
//
// Reading a file is an impure act, which is why this lives beside the verdict
// module rather than inside it: `skip_baseline` stays pure over the values it
// is handed, and does not import this file.

import { existsSync, readFileSync } from "node:fs";

/**
 * What an extraction found.
 *
 * `named` with an EMPTY array is a real answer — the report was read and
 * nothing was skipped. `unavailable` is the absence of an answer: no report, an
 * unreadable one, or bytes that are not a report at all. Collapsing the second
 * into the first is the fail-open shape that reads every missing artifact as a
 * clean, skip-free run.
 */
export type SkipIdentities =
  | { readonly status: "named"; readonly names: readonly string[] }
  | { readonly status: "unavailable" };

/** The five XML entities a junit producer escapes attribute values with. */
const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** Undo attribute escaping, so an identity matches the name a human typed. */
function unescapeXml(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (whole, entity: string) => {
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith("#")) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
    return ENTITIES[entity] ?? whole;
  });
}

/** Pull `name="value"` pairs out of one element's attribute text. */
function attributes(source: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const match of source.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) {
    found[match[1] as string] = unescapeXml(match[2] as string);
  }
  return found;
}

/**
 * The identity of one skipped test: the file it lives in, then its name.
 *
 * The FILE is part of the identity on purpose. Two files may each hold a test
 * called `renders`, and an identity that is the bare name collapses them into
 * one set member — so a comparison would lose a skip every time the same name
 * appears twice, which is exactly when a ratchet is worth having.
 */
function identity(scope: string | undefined, name: string): string {
  const where =
    scope === undefined || scope.length === 0 ? "" : `${scope}${SKIP_IDENTITY_SEPARATOR}`;
  return `${where}${name}`;
}

/**
 * What separates the scope from the test name inside one identity.
 *
 * Exported because a caller that re-anchors the scope (see
 * `gate_identity_run`) has to find the boundary, and a second copy of the
 * literal is a thing that can drift from this one — silently, since a mismatched
 * separator simply never splits and the identity is passed through unchanged,
 * which looks exactly like "there was no scope to re-anchor".
 */
export const SKIP_IDENTITY_SEPARATOR = " > ";

/**
 * Match every `<tag …>` element: group 1 is the attribute text, group 3 the
 * inner body — `undefined` for the self-closing form, which has no children.
 *
 * ONE shape, built once. Suites and cases are read with the same pattern, and
 * two hand-written copies of it are two things that can drift apart. The way
 * that drift shows up is not a clean miss: a copy that stops matching the
 * self-closing form lets `[\s\S]*?` run past it to the NEXT closing tag, and
 * the elements in between are swallowed rather than read. The tag name is the
 * one thing the two call sites genuinely differ in, so it is the one thing
 * passed in.
 *
 * `\b` after the name keeps `<testsuite>` from matching `<testsuites>` — the
 * root element is a different question, asked separately below.
 */
function elementsOf(tag: string): RegExp {
  return new RegExp(`<${tag}\\b([^>]*?)(\\/>|>([\\s\\S]*?)<\\/${tag}\\s*>)`, "g");
}

/** Every `<testcase>` in `body` that carries a `<skipped>` child, as identities. */
function skippedIn(body: string, suiteScope: string | undefined): string[] {
  const names: string[] = [];
  // A self-closing testcase has no children and therefore no `<skipped/>`; only
  // the paired form can be a skip. Both shapes are matched so the self-closing
  // ones are consumed rather than swallowing the document after them.
  for (const match of body.matchAll(elementsOf("testcase"))) {
    const attrs = attributes(match[1] as string);
    const inner = match[3];
    if (inner === undefined || !/<skipped\b/.test(inner)) continue;
    const name = attrs.name;
    if (name === undefined) continue;
    names.push(identity(attrs.file ?? attrs.classname ?? suiteScope, name));
  }
  return names;
}

/**
 * Does the document's ROOT element close?
 *
 * The question is asked of the root and of nothing else. A single regex over
 * the whole document cannot ask it: an unclosed `<testsuites>` whose body holds
 * complete `<testsuite>…</testsuite>` children lets the match START at a child,
 * and the wreckage a writer killed mid-write then reads as a well-formed report
 * carrying only the suites that survived the cut — a PARTIAL named set, which
 * is the fail-open shape this guard exists to prevent, and worse than an empty
 * one because it hides a real new skip while still looking like an answer.
 *
 * So: find the first element (the prolog — declaration, comments, doctype — is
 * not it), demand it be a junit root, then walk the same name's opening and
 * closing tags from there, tracking depth. The root closes only when the depth
 * it opened returns to zero. Same-named nesting is counted rather than assumed
 * away, and `\b` keeps `<testsuite>` and `<testsuites>` from closing each other.
 */
function rootCloses(document: string): boolean {
  const opening = /<([A-Za-z_][\w:.-]*)((?:"[^"]*"|[^">])*)>/.exec(document);
  if (opening === null) return false;

  const name = opening[1] as string;
  if (name !== "testsuite" && name !== "testsuites") return false;

  const selfClosing = (attrs: string): boolean => attrs.trimEnd().endsWith("/");
  if (selfClosing(opening[2] as string)) return true;

  const tags = new RegExp(`<(/?)${name}\\b((?:"[^"]*"|[^">])*)>`, "g");
  tags.lastIndex = opening.index;
  let depth = 0;
  for (let tag = tags.exec(document); tag !== null; tag = tags.exec(document)) {
    if (tag[1] === "/") {
      depth -= 1;
      if (depth === 0) return true;
    } else if (!selfClosing(tag[2] as string)) {
      depth += 1;
    }
  }
  return false;
}

/**
 * Read the skipped-test identities out of the junit report at `reportPath`.
 *
 * Arity ONE, deliberately: there is no default path, so there is nothing here
 * that could disagree with the caller about where the report was written.
 */
export function extractSkipIdentities(reportPath: string): SkipIdentities {
  if (!existsSync(reportPath)) return { status: "unavailable" };

  let document: string;
  try {
    document = readFileSync(reportPath, "utf-8");
  } catch {
    return { status: "unavailable" };
  }

  // Bytes that are not a report at all are UNAVAILABLE, never an empty set: a
  // parse failure read as "nothing was skipped" passes every later comparison
  // (AC-STE-529.7 — the same fail-open shape AC-STE-508.4 closed for counts).
  if (!rootCloses(document)) return { status: "unavailable" };

  const names: string[] = [];
  const suites = [...document.matchAll(elementsOf("testsuite"))];
  for (const suite of suites) {
    const attrs = attributes(suite[1] as string);
    const body = suite[3];
    if (body === undefined) continue;
    names.push(...skippedIn(body, attrs.file ?? attrs.name));
  }
  // A producer that emits testcases directly under the root, with no testsuite
  // wrapper, is still a report. Its cases are only read when no suite claimed
  // them, so a nested case is never counted twice.
  if (suites.length === 0) names.push(...skippedIn(document, undefined));

  return { status: "named", names };
}

/** Single-quote a path for `/bin/sh`, leaving the path itself literal. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * One stack's identity source: the label a record quotes, and the invocation
 * that produces the report.
 */
interface IdentitySource {
  /** What a record writes into `namesSource` when this source was used. */
  readonly label: string;
  /** The invocation that writes the report at the CALLER's `reportPath`. */
  compose(reportPath: string): string;
}

/**
 * The stacks whose runners can name their skips.
 *
 * ONE table, read by both `skipIdentityCommand` and `skipNamesSource`. Two
 * tables would let a stack be composed a command by one function and disowned
 * by the other, and the record would then carry a `namesSource` that flatly
 * contradicts how the names were obtained.
 */
const IDENTITY_SOURCES: Readonly<Record<string, IdentitySource>> = {
  bun: {
    label: "bun test --reporter=junit",
    compose: (reportPath: string): string =>
      `bun test --reporter=junit --reporter-outfile=${shellQuote(reportPath)}`,
  },
};

/**
 * The runner invocation that writes a machine-readable report at `reportPath`
 * while still printing the summary the count parser reads — or `null` for a
 * stack whose runner has no such report.
 *
 * `null` is not a failure. It is the honest answer for a stack this build
 * cannot name skips on, and the caller degrades to a count-only comparison.
 */
export function skipIdentityCommand(stack: string, reportPath: string): string | null {
  const source = IDENTITY_SOURCES[stack];
  return source === undefined ? null : source.compose(reportPath);
}

/**
 * What a record captured on `stack` writes into `namesSource` (AC-STE-529.8).
 *
 * ALWAYS a non-empty string, including for a stack that cannot name its skips:
 * the degrade is a FACT written into the record, naming the stack that could
 * not produce identities. An absent `namesSource` therefore means one thing
 * only — nobody wrote one — and it can no longer be confused with "this runner
 * has no report to read", which is what a bare missing key would have to carry
 * both meanings of.
 */
export function skipNamesSource(stack: string): string {
  const source = IDENTITY_SOURCES[stack];
  if (source !== undefined) return source.label;
  return `none — the ${stack} runner writes no machine-readable skip report in this build`;
}

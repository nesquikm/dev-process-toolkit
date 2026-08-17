// asserted_token_source — resolve an asserted token against the source that
// would EMIT it, at the layer the assertion is making its claim.
//
// WHY THIS MODULE EXISTS (STE-485 AC.5). Fixture 3c drifted three times by
// asserting a token that exists somewhere in the repository but is not what the
// runtime renders into the capture the fixture greps. "It is in the repo" is not
// evidence: a probe's module FILENAME contains the probe id, an import path
// mentions it, a comment names it. None of those is an emission, and a check
// that only greps the tree would bless every one of them.
//
// THE LAYER SPLIT IS THE POINT. A claim is made at one of two layers:
//
//   capture — the RUNTIME rendered this token into a child capture. Scored on
//             `extractAssistantText`, never raw bytes: `claude -p` injects the
//             invoked skill's own SKILL.md body as a synthetic `user` event, so
//             a raw grep matches the DOCUMENTATION of a token rather than its
//             emission (the STE-421 finding, in the general case).
//   module  — a MODULE builds this token into a message it returns. Scored on
//             code only: a token named in a comment is documentation.
//
// A module emission never licenses a capture-layer claim, and vice versa. That
// asymmetry is the whole check — probe #37's underscored id is built by its
// module AND rendered by the runtime, while its hyphenated id is rendered by
// the runtime and built by nothing.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { extractAssistantText } from "./smoke_child_capture";
import { SMOKE_LEGS } from "./smoke_fixture_groups";

/** The two layers a token claim can be made at. There is no third. */
export const ASSERTION_LAYERS = ["capture", "module"] as const;

/** One of the two layers. */
export type AssertionLayer = (typeof ASSERTION_LAYERS)[number];

/** One place a token could be emitted from, already read. */
export interface TokenSource {
  /** How the source is named in evidence — a repo-relative path. */
  readonly path: string;
  /** The source's text: a module's code, or a capture's ASSISTANT projection. */
  readonly text: string;
  readonly layer: AssertionLayer;
}

/** A claim that some token is emitted at some layer. */
export interface AssertedTokenClaim {
  readonly token: string;
  readonly layer: AssertionLayer;
}

/** What the sources say about one claim. */
export interface AssertedTokenEvidence {
  readonly token: string;
  readonly layer: AssertionLayer;
  /** True iff at least one same-layer source emits the token. */
  readonly emitted: boolean;
  /** Total emissions across same-layer sources. */
  readonly emissions: number;
  /** Same-layer sources with at least one emission, in source order. */
  readonly emittingSources: readonly string[];
  /** Same-layer sources that mention the token ONLY as a filename / path. */
  readonly filenameOnlySources: readonly string[];
}

/** Characters that can occur inside a path-shaped token run. */
const PATH_CHAR = /[A-Za-z0-9_.@\-/\\]/;

/** A run that ends in a source-file extension is a filename, not an emission. */
const SOURCE_EXTENSION_RE = /\.[A-Za-z0-9]{1,8}$/;

/** Start indexes of every non-overlapping occurrence of `token`. */
function occurrences(text: string, token: string): number[] {
  if (!token) return [];
  const out: number[] = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf(token, from);
    if (at < 0) return out;
    out.push(at);
    from = at + token.length;
  }
}

/**
 * The maximal path-shaped run containing `[start, end)`. Punctuation that ends
 * a path (`:`, `,`, backtick, quote, whitespace) bounds the run, so
 * `` `cross_cutting_spec_stale_file_refs: ${reason}` `` yields the bare token
 * while `adapters/_shared/src/cross_cutting_spec_stale_file_refs.ts` yields the
 * whole path.
 */
function pathRunAround(text: string, start: number, end: number): string {
  let from = start;
  while (from > 0 && PATH_CHAR.test(text[from - 1] as string)) from -= 1;
  let to = end;
  while (to < text.length && PATH_CHAR.test(text[to] as string)) to += 1;
  return text.slice(from, to);
}

/** `a/b/c.ts` → `c`; `./thing` → `thing`. */
function referentOf(run: string): string {
  const tail = run.split(/[/\\]/).pop() ?? run;
  return tail.replace(SOURCE_EXTENSION_RE, "");
}

/**
 * Is this occurrence a filename / path mention rather than an emission?
 *
 * Two shapes qualify, and only two: a run that ends in a file extension, and a
 * path-shaped run (it carries a separator) that names the source's OWN module.
 * A bare token with no separator and no extension is never a filename mention,
 * even when the source file happens to be named after it — that is exactly the
 * probe module's case, where `buildMessage` builds the same string the file is
 * named for.
 */
function isFilenameMention(run: string, sourcePath: string): boolean {
  if (SOURCE_EXTENSION_RE.test(run)) return true;
  if (!/[/\\]/.test(run)) return false;
  return referentOf(run) === referentOf(sourcePath);
}

/**
 * Blank out comment lines while preserving every byte offset. Line-based on
 * purpose: it cannot be confused by a `//` inside a URL or a regex literal, and
 * every documentation mention this check has to reject is a whole comment line.
 */
function maskCommentLines(text: string): string {
  let inBlock = false;
  return text
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      let blank = inBlock;
      if (inBlock) {
        if (trimmed.includes("*/")) inBlock = false;
      } else if (trimmed.startsWith("//")) {
        blank = true;
      } else if (trimmed.startsWith("/*")) {
        blank = true;
        if (!trimmed.includes("*/")) inBlock = true;
      } else if (trimmed.startsWith("*")) {
        blank = true;
      }
      return blank ? " ".repeat(line.length) : line;
    })
    .join("\n");
}

/** The text a source's emissions are counted over. */
function emittableText(source: TokenSource): string {
  return source.layer === "module" ? maskCommentLines(source.text) : source.text;
}

/** How one source's occurrences of a token split. Every occurrence is one or the other. */
interface OccurrenceSplit {
  /** Genuine emissions — neither filename/path mentions nor masked comment prose. */
  readonly emissions: number;
  /** Mentions that only name a file or a path. */
  readonly filenameMentions: number;
}

/**
 * Classify every occurrence of `token` in `source`, once. The two exported
 * counters and `checkAssertedToken` are all the same walk over the same masked
 * text differing only in which half of the split they read, so they share it —
 * which also stops a source being comment-masked twice to answer one claim.
 */
function splitOccurrences(source: TokenSource, token: string): OccurrenceSplit {
  const text = emittableText(source);
  let emissions = 0;
  let filenameMentions = 0;
  for (const at of occurrences(text, token)) {
    if (isFilenameMention(pathRunAround(text, at, at + token.length), source.path)) {
      filenameMentions += 1;
    } else {
      emissions += 1;
    }
  }
  return { emissions, filenameMentions };
}

/**
 * Occurrences of `token` in `source` that are genuine emissions — neither
 * filename/path mentions nor (at the module layer) comment prose.
 */
export function countTokenEmissions(source: TokenSource, token: string): number {
  return splitOccurrences(source, token).emissions;
}

/** Occurrences of `token` in `source` that are filename / path mentions. */
export function countTokenFilenameMentions(source: TokenSource, token: string): number {
  return splitOccurrences(source, token).filenameMentions;
}

/**
 * Resolve one claim against the sources. ONLY sources whose layer matches the
 * claim's layer participate — a module emission does not license a
 * capture-layer assertion, which is the failure mode this module exists for.
 */
export function checkAssertedToken(
  claim: AssertedTokenClaim,
  sources: readonly TokenSource[],
): AssertedTokenEvidence {
  let emissions = 0;
  const emittingSources: string[] = [];
  const filenameOnlySources: string[] = [];

  for (const source of sources) {
    if (source.layer !== claim.layer) continue;
    const split = splitOccurrences(source, claim.token);
    if (split.emissions > 0) {
      emissions += split.emissions;
      emittingSources.push(source.path);
      continue;
    }
    if (split.filenameMentions > 0) {
      filenameOnlySources.push(source.path);
    }
  }

  return {
    token: claim.token,
    layer: claim.layer,
    emitted: emissions > 0,
    emissions,
    emittingSources,
    filenameOnlySources,
  };
}

/** The expectation words a `capability_row_assert` invocation can carry. */
const EXPECTATIONS: ReadonlySet<string> = new Set(["present", "absent", "any-of"]);

/** Split a shell form into words, honouring single and double quotes. */
function shellWords(shell: string): string[] {
  const words: string[] = [];
  let word = "";
  let quote: '"' | "'" | null = null;
  let started = false;
  for (const char of shell) {
    if (quote) {
      if (char === quote) quote = null;
      else word += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      started = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (started || word) words.push(word);
      word = "";
      started = false;
      continue;
    }
    word += char;
  }
  if (started || word) words.push(word);
  return words;
}

/**
 * The KEY arguments of a `capability_row_assert` invocation: everything after
 * the expectation word and the capture path. The expectation and the capture
 * path are the invocation's own machinery, never asserted tokens, so a guard
 * built on this can never demand that `any-of` be emitted by anything.
 */
export function assertedTokensIn(shell: string): readonly string[] {
  const words = shellWords(shell);
  const at = words.findIndex((word) => EXPECTATIONS.has(word));
  if (at < 0) return [];
  return words.slice(at + 2);
}

/** Where the plugin sits, relative to whichever root the caller passes. */
const PLUGIN_PREFIXES = ["plugins/dev-process-toolkit", ""] as const;

/**
 * Derived, never restated. `smoke_fixture_groups` declares `SMOKE_LEGS` THE
 * authority — "every other statement of the leg set derives from this array,
 * never from a second copy" — and a literal here was a third copy of it. The
 * failure mode is specific: widen the registry with a fourth leg and a literal
 * silently keeps scanning three, so the new leg's captures resolve to nothing
 * and every token asserted against them reads NOT-EMITTED. That is a false
 * negative on exactly the leg nobody had tested yet.
 */
const PROBE_CAPTURE_LEGS = SMOKE_LEGS;

/**
 * What makes a module a PROBE module: it exports a `run…Probe` entry point.
 *
 * The scope matters as much as the rule. Harness and registry modules under the
 * same directory carry probe ids as SELECTORS — a falsifiability row naming the
 * span it slices out of a SKILL, a roster listing ids to iterate. Those are
 * references to an emission, not the emission, and counting them would let a
 * fixture license its own assertion by the act of registering it.
 */
const PROBE_ENTRY_RE = /export\s+(?:async\s+)?function\s+run[A-Za-z0-9_]*Probe\s*\(/;

function firstExistingDir(repoRoot: string, tail: string): string | null {
  for (const prefix of PLUGIN_PREFIXES) {
    const candidate = prefix ? join(repoRoot, prefix, tail) : join(repoRoot, tail);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/**
 * The shipped sources a token claim resolves against.
 *
 * Capture layer: the probe-#37 captures, projected through
 * `extractAssistantText` — a token that only ever appears in a capture's
 * injected synthetic skill body contributes nothing and is NOT emitted.
 * Module layer: the probe modules under `adapters/_shared/src`.
 */
export function defaultTokenSources(repoRoot: string): readonly TokenSource[] {
  const sources: TokenSource[] = [];

  const fixtures = firstExistingDir(repoRoot, "tests/fixtures/m127-falsifiability");
  if (fixtures) {
    for (const leg of PROBE_CAPTURE_LEGS) {
      const path = join(fixtures, `gate-check-probe37-${leg}.ndjson`);
      if (!existsSync(path)) continue;
      sources.push({
        path: relative(repoRoot, path),
        text: extractAssistantText(readFileSync(path, "utf8")),
        layer: "capture",
      });
    }
  }

  const modules = firstExistingDir(repoRoot, "adapters/_shared/src");
  if (modules) {
    for (const name of readdirSync(modules).sort()) {
      if (!name.endsWith(".ts")) continue;
      const path = join(modules, name);
      const text = readFileSync(path, "utf8");
      if (!PROBE_ENTRY_RE.test(text)) continue;
      sources.push({ path: relative(repoRoot, path), text, layer: "module" });
    }
  }

  return sources;
}
